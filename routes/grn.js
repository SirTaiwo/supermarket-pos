// =====================================================
// Supermarket POS — Goods Received Notes routes
// =====================================================
// Manager-only goods receipt management.
//
//   GET  /grn          — list all GRNs (most recent first)
//   GET  /grn/new      — form to record a new GRN
//   POST /grn          — submit new GRN, atomic stock update
//   GET  /grn/:id      — view a posted GRN (read-only)
// =====================================================

const express = require("express");
const db = require("../data/db");
const { requireManager } = require("../middleware/auth");
const {
    formatRand,
    formatDate,
    generateGrnReference,
} = require("../middleware/helpers");

const router = express.Router();


// =====================================================
// GET /grn — list all GRNs
// =====================================================
router.get("/grn", requireManager, (req, res) => {
    const grns = db.prepare(`
        SELECT
            g.id,
            g.reference,
            g.received_at,
            g.supplier_invoice,
            g.subtotal_cents,
            g.vat_cents,
            g.total_cents,
            g.status,
            s.name AS supplier_name,
            u.full_name AS received_by_name,
            (SELECT COUNT(*) FROM goods_received_items WHERE grn_id = g.id) AS line_count,
            (SELECT SUM(quantity) FROM goods_received_items WHERE grn_id = g.id) AS total_units
        FROM goods_received_notes g
        LEFT JOIN suppliers s ON g.supplier_id = s.id
        LEFT JOIN users     u ON g.received_by = u.id
        ORDER BY g.received_at DESC
        LIMIT 100
    `).all();

    res.render("grn", {
        title:      "Goods received",
        active:     "grn",
        grns:       grns,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


// =====================================================
// GET /grn/new — form to record a new GRN
// =====================================================
router.get("/grn/new", requireManager, (req, res) => {
    // Only active suppliers go in the dropdown
    const suppliers = db.prepare(`
        SELECT id, name, payment_terms
        FROM suppliers
        WHERE is_active = 1
        ORDER BY name ASC
    `).all();

    // Only active products are receivable
    // We include cost and VAT info so the form can prefill / autocompute
    const products = db.prepare(`
        SELECT
            p.id,
            p.sku,
            p.name,
            p.cost_cents,
            p.stock_qty,
            v.rate_percent AS vat_rate_percent,
            v.name         AS vat_name
        FROM products p
        LEFT JOIN vat_categories v ON p.vat_category_id = v.id
        WHERE p.is_active = 1
        ORDER BY p.name ASC
    `).all();

    res.render("grn-form", {
        title:     "Record new delivery",
        active:    "grn",
        suppliers: suppliers,
        products:  products,
    });
});


// =====================================================
// POST /grn — submit a new GRN (atomic)
// =====================================================
// Receives:
//   supplier_id         — required, must be an active supplier
//   supplier_invoice    — optional, free-text
//   notes               — optional
//   lines               — JSON array of { product_id, quantity, unit_cost_cents }
//
// Server-side recalculation:
//   - We DO NOT trust totals from the client.
//   - For each line, we look up the product's VAT rate from the database.
//   - We compute line_subtotal, line_vat, line_total ourselves.
//   - Final totals are summed from these computed lines.
//
// Atomic operations (single transaction):
//   1. Insert GRN header (with computed totals)
//   2. Insert line items (with product name/sku snapshot)
//   3. Increment products.stock_qty for each line
//   4. Record the reference; if any step fails, ALL ROLL BACK
// =====================================================
router.post("/grn", requireManager, (req, res) => {
    const { supplier_id, supplier_invoice, notes, lines: linesRaw } = req.body;

    // ----- Validation -----
    const errors = [];

    const supplierId = parseInt(supplier_id, 10);
    if (!supplierId || isNaN(supplierId)) {
        errors.push("Supplier is required.");
    }

    let lines;
    try {
        lines = JSON.parse(linesRaw || "[]");
    } catch (err) {
        errors.push("Could not read line items.");
        lines = [];
    }

    if (!Array.isArray(lines) || lines.length === 0) {
        errors.push("At least one line item is required.");
    }

    // Verify supplier exists and is active
    if (supplierId) {
        const supplier = db.prepare(
            "SELECT id, name FROM suppliers WHERE id = ? AND is_active = 1"
        ).get(supplierId);
        if (!supplier) {
            errors.push("That supplier no longer exists or is inactive.");
        }
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect("/grn/new");
    }

    // ----- Per-line validation and server-side calculation -----
    const computedLines = [];
    let subtotalCents = 0;
    let vatCents = 0;
    let totalCents = 0;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const productId = parseInt(raw.product_id, 10);
        const quantity  = parseInt(raw.quantity, 10);
        const unitCost  = parseInt(raw.unit_cost_cents, 10);

        if (!productId || !quantity || quantity <= 0 || isNaN(unitCost) || unitCost < 0) {
            req.flash("error", `Line ${i + 1}: invalid product, quantity, or cost.`);
            return res.redirect("/grn/new");
        }

        // Look up the product from the database (don't trust the client)
        const product = db.prepare(`
            SELECT
                p.id, p.sku, p.name,
                v.rate_percent AS vat_rate_percent
            FROM products p
            LEFT JOIN vat_categories v ON p.vat_category_id = v.id
            WHERE p.id = ? AND p.is_active = 1
        `).get(productId);

        if (!product) {
            req.flash("error", `Line ${i + 1}: product no longer exists.`);
            return res.redirect("/grn/new");
        }

        // Calculate this line's amounts.
        //
        // Important: GRN costs are USUALLY entered VAT-EXCLUSIVE
        // (supplier invoices typically show "price excl VAT" plus
        //  a separate VAT line). So we treat unit_cost_cents as the
        // NET (excl VAT) cost and add VAT on top.
        //
        // This is OPPOSITE to sales, where customer-facing prices
        // are VAT-INCLUSIVE.
        const vatRate = product.vat_rate_percent || 0;
        const lineSubtotal = unitCost * quantity;
        const lineVat      = Math.round(lineSubtotal * vatRate / 100);
        const lineTotal    = lineSubtotal + lineVat;

        computedLines.push({
            product_id:          product.id,
            product_name:        product.name,
            product_sku:         product.sku,
            quantity:            quantity,
            unit_cost_cents:     unitCost,
            line_subtotal_cents: lineSubtotal,
            vat_rate_percent:    vatRate,
            line_vat_cents:      lineVat,
            line_total_cents:    lineTotal,
        });

        subtotalCents += lineSubtotal;
        vatCents      += lineVat;
        totalCents    += lineTotal;
    }

    // ----- All atomic. If anything fails, roll back. -----
    const reference = generateGrnReference(db);

    const insertHeader = db.prepare(`
        INSERT INTO goods_received_notes
            (reference, supplier_id, received_by, supplier_invoice,
             subtotal_cents, vat_cents, total_cents, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?)
    `);

    const insertItem = db.prepare(`
        INSERT INTO goods_received_items
            (grn_id, product_id, product_name, product_sku,
             quantity, unit_cost_cents,
             line_subtotal_cents, vat_rate_percent,
             line_vat_cents, line_total_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const incrementStock = db.prepare(`
        UPDATE products
        SET stock_qty = stock_qty + ?
        WHERE id = ?
    `);

    let newGrnId;
    try {
        db.transaction(() => {
            const result = insertHeader.run(
                reference,
                supplierId,
                req.user.id,
                supplier_invoice && supplier_invoice.trim() ? supplier_invoice.trim() : null,
                subtotalCents,
                vatCents,
                totalCents,
                notes && notes.trim() ? notes.trim() : null
            );

            newGrnId = result.lastInsertRowid;

            for (const line of computedLines) {
                insertItem.run(
                    newGrnId,
                    line.product_id,
                    line.product_name,
                    line.product_sku,
                    line.quantity,
                    line.unit_cost_cents,
                    line.line_subtotal_cents,
                    line.vat_rate_percent,
                    line.line_vat_cents,
                    line.line_total_cents
                );

                incrementStock.run(line.quantity, line.product_id);
            }
        })();

        req.flash(
            "success",
            `GRN ${reference} posted — ${computedLines.length} line(s), total ${formatRand(totalCents)}.`
        );
        res.redirect(`/grn/${newGrnId}`);
    } catch (err) {
        console.error("Error posting GRN:", err);
        req.flash("error", "Could not post GRN: " + err.message);
        res.redirect("/grn/new");
    }
});


// =====================================================
// GET /grn/:id — view a posted GRN (read-only)
// =====================================================
router.get("/grn/:id", requireManager, (req, res) => {
    const grnId = parseInt(req.params.id, 10);

    const grn = db.prepare(`
        SELECT
            g.*,
            s.name             AS supplier_name,
            s.contact_person   AS supplier_contact,
            s.phone            AS supplier_phone,
            s.email            AS supplier_email,
            s.payment_terms    AS supplier_payment_terms,
            u.full_name        AS received_by_name
        FROM goods_received_notes g
        LEFT JOIN suppliers s ON g.supplier_id = s.id
        LEFT JOIN users     u ON g.received_by = u.id
        WHERE g.id = ?
    `).get(grnId);

    if (!grn) {
        return res.status(404).render("error", {
            title:   "GRN not found",
            message: `No GRN with ID ${grnId}.`,
        });
    }

    const items = db.prepare(`
        SELECT *
        FROM goods_received_items
        WHERE grn_id = ?
        ORDER BY id ASC
    `).all(grnId);

    res.render("grn-detail", {
        title:      `GRN ${grn.reference}`,
        active:     "grn",
        grn:        grn,
        items:      items,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


module.exports = router;