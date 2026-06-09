// =====================================================
// Supermarket POS — Returns & Refunds routes
// =====================================================
// Cashier or manager can process refunds against an
// original sale. Refunds:
//   - MUST link to an existing sale
//   - Allow partial refunds (1 of 3 items, etc.)
//   - Enforce cumulative limit (can't refund more than
//     was originally sold, across all prior refunds)
//   - Are immutable once posted (audit trail)
//   - Atomically: insert header + items, increment stock
//
//   GET  /returns                   — list all refunds
//   GET  /returns/new               — search for original sale
//   GET  /returns/from-sale/:saleId — show refund form for that sale
//   POST /returns                   — submit refund (atomic)
//   GET  /returns/:id               — view a posted refund (read-only)
// =====================================================

const express = require("express");
const db = require("../data/db");
const { requireLogin } = require("../middleware/auth");
const {
    formatRand,
    formatDate,
    generateRefundReference,
} = require("../middleware/helpers");

const router = express.Router();


// =====================================================
// GET /returns — list all refunds
// =====================================================
router.get("/returns", requireLogin, (req, res) => {
    const refunds = db.prepare(`
        SELECT
            r.id,
            r.reference,
            r.created_at,
            r.subtotal_cents,
            r.vat_cents,
            r.total_cents,
            r.reason,
            r.original_sale_id,
            s.reference AS original_sale_reference,
            u.full_name AS cashier_name,
            (SELECT COUNT(*) FROM refund_items WHERE refund_id = r.id) AS line_count,
            (SELECT SUM(quantity_refunded) FROM refund_items WHERE refund_id = r.id) AS total_units
        FROM refunds r
        LEFT JOIN sales s ON r.original_sale_id = s.id
        LEFT JOIN users u ON r.cashier_id = u.id
        ORDER BY r.created_at DESC
        LIMIT 100
    `).all();

    res.render("returns", {
        title:      "Refunds",
        active:     "returns",
        refunds:    refunds,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


// =====================================================
// GET /returns/new — search for original sale
// =====================================================
router.get("/returns/new", requireLogin, (req, res) => {
    const q = req.query.q || "";

    // If a search query is provided, look up matching sales
    let results = [];
    if (q && q.trim()) {
        const searchTerm = q.trim();
        results = db.prepare(`
            SELECT
                s.id,
                s.reference,
                s.created_at,
                s.total_cents,
                u.full_name AS cashier_name,
                (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS line_count,
                (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS total_units
            FROM sales s
            LEFT JOIN users u ON s.cashier_id = u.id
            WHERE s.reference LIKE ?
            ORDER BY s.created_at DESC
            LIMIT 20
        `).all(`%${searchTerm}%`);
    }

    res.render("returns-search", {
        title:      "Find sale to refund",
        active:     "returns",
        q:          q,
        results:    results,
        hasSearched: !!q,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


// =====================================================
// GET /returns/from-sale/:saleId — show refund form
// =====================================================
// Shows all items from the original sale with quantity
// inputs. For each item, we display:
//   - original quantity sold
//   - quantity already refunded (from any prior refunds)
//   - quantity available to refund (the remainder)
// =====================================================
router.get("/returns/from-sale/:saleId", requireLogin, (req, res) => {
    const saleId = parseInt(req.params.saleId, 10);

    // Look up the original sale
    const sale = db.prepare(`
        SELECT
            s.*,
            u.full_name AS cashier_name
        FROM sales s
        LEFT JOIN users u ON s.cashier_id = u.id
        WHERE s.id = ?
    `).get(saleId);

    if (!sale) {
        return res.status(404).render("error", {
            title:   "Sale not found",
            message: `No sale with ID ${saleId}.`,
        });
    }

    // Look up the sale items with cumulative refund info
    const items = db.prepare(`
        SELECT
            si.id,
            si.product_id,
            si.product_name,
            si.product_sku,
            si.quantity,
            si.unit_price_cents,
            si.vat_rate_percent,
            si.line_subtotal_cents,
            si.line_vat_cents,
            si.line_total_cents,
            COALESCE(
                (SELECT SUM(quantity_refunded) FROM refund_items WHERE original_sale_item_id = si.id),
                0
            ) AS already_refunded
        FROM sale_items si
        WHERE si.sale_id = ?
        ORDER BY si.id ASC
    `).all(saleId);

    // Add a computed "available to refund" field
    items.forEach(item => {
        item.available_to_refund = item.quantity - item.already_refunded;
    });

    // Check if anything is even refundable
    const anyRefundable = items.some(item => item.available_to_refund > 0);

    res.render("returns-form", {
        title:           `Refund from ${sale.reference}`,
        active:          "returns",
        sale:            sale,
        items:           items,
        anyRefundable:   anyRefundable,
        formatRand:      formatRand,
        formatDate:      formatDate,
    });
});


// =====================================================
// POST /returns — submit a refund (atomic)
// =====================================================
// Receives:
//   original_sale_id  — required
//   reason            — optional, free text
//   note              — optional, free text
//   items             — JSON array of { sale_item_id, quantity_refunded }
//
// Server-side recalculation:
//   - For each item, look up the original sale_item
//   - Validate cumulative refund doesn't exceed original qty
//   - Compute line amounts from original unit_price + vat_rate
//   - Sum to get header totals
//
// Atomic operations:
//   1. Insert refund header
//   2. Insert refund_items (with snapshots)
//   3. Increment products.stock_qty for each line
//   4. All in one transaction
// =====================================================
router.post("/returns", requireLogin, (req, res) => {
    const { original_sale_id, reason, note, items: itemsRaw } = req.body;

    const errors = [];

    const saleId = parseInt(original_sale_id, 10);
    if (!saleId || isNaN(saleId)) errors.push("Original sale is required.");

    let items;
    try {
        items = JSON.parse(itemsRaw || "[]");
    } catch (err) {
        errors.push("Could not read refund items.");
        items = [];
    }

    if (!Array.isArray(items) || items.length === 0) {
        errors.push("Select at least one item to refund.");
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect(`/returns/from-sale/${saleId || 0}`);
    }

    // Verify the original sale exists
    const sale = db.prepare("SELECT id, reference FROM sales WHERE id = ?").get(saleId);
    if (!sale) {
        req.flash("error", "Original sale not found.");
        return res.redirect("/returns/new");
    }

    // Build the computed refund lines from validated server-side data
    const computedLines = [];
    let subtotalCents = 0;
    let vatCents = 0;
    let totalCents = 0;

    for (let i = 0; i < items.length; i++) {
        const raw = items[i];
        const saleItemId = parseInt(raw.sale_item_id, 10);
        const qtyToRefund = parseInt(raw.quantity_refunded, 10);

        if (!saleItemId || !qtyToRefund || qtyToRefund <= 0) {
            // Skip lines with zero or invalid qty — they didn't want to refund this line
            continue;
        }

        // Look up the original sale_item
        const saleItem = db.prepare(`
            SELECT
                si.id, si.sale_id, si.product_id, si.product_name, si.product_sku,
                si.quantity, si.unit_price_cents, si.vat_rate_percent
            FROM sale_items si
            WHERE si.id = ? AND si.sale_id = ?
        `).get(saleItemId, saleId);

        if (!saleItem) {
            req.flash("error", `Sale line ${saleItemId} not found in sale ${sale.reference}.`);
            return res.redirect(`/returns/from-sale/${saleId}`);
        }

        // Check cumulative already-refunded
        const alreadyRefunded = db.prepare(`
            SELECT COALESCE(SUM(quantity_refunded), 0) AS n
            FROM refund_items
            WHERE original_sale_item_id = ?
        `).get(saleItemId).n;

        const maxRefundable = saleItem.quantity - alreadyRefunded;

        if (qtyToRefund > maxRefundable) {
            req.flash(
                "error",
                `Cannot refund ${qtyToRefund} of "${saleItem.product_name}" — ` +
                `only ${maxRefundable} of ${saleItem.quantity} remains refundable.`
            );
            return res.redirect(`/returns/from-sale/${saleId}`);
        }

        // Calculate this line's amounts (VAT-inclusive — sales prices are VAT-inclusive)
        // We re-derive from the snapshot in the original sale_item, ensuring
        // the historical VAT treatment is preserved exactly.
        const vatRate = saleItem.vat_rate_percent;
        const lineTotal = saleItem.unit_price_cents * qtyToRefund;
        const lineVat = Math.round((lineTotal * vatRate) / (100 + vatRate));
        const lineSubtotal = lineTotal - lineVat;

        computedLines.push({
            original_sale_item_id: saleItem.id,
            product_id:            saleItem.product_id,
            product_name:          saleItem.product_name,
            product_sku:           saleItem.product_sku,
            quantity_refunded:     qtyToRefund,
            unit_price_cents:      saleItem.unit_price_cents,
            line_subtotal_cents:   lineSubtotal,
            vat_rate_percent:      vatRate,
            line_vat_cents:        lineVat,
            line_total_cents:      lineTotal,
        });

        subtotalCents += lineSubtotal;
        vatCents      += lineVat;
        totalCents    += lineTotal;
    }

    if (computedLines.length === 0) {
        req.flash("error", "No items selected to refund.");
        return res.redirect(`/returns/from-sale/${saleId}`);
    }


    // ----- All atomic. If anything fails, roll back. -----
    const reference = generateRefundReference(db);

    const insertRefund = db.prepare(`
        INSERT INTO refunds
            (reference, original_sale_id, cashier_id, refund_method,
             subtotal_cents, vat_cents, total_cents, reason, note)
        VALUES (?, ?, ?, 'cash', ?, ?, ?, ?, ?)
    `);

    const insertItem = db.prepare(`
        INSERT INTO refund_items
            (refund_id, original_sale_item_id, product_id, product_name, product_sku,
             quantity_refunded, unit_price_cents,
             line_subtotal_cents, vat_rate_percent,
             line_vat_cents, line_total_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const incrementStock = db.prepare(`
        UPDATE products
        SET stock_qty = stock_qty + ?
        WHERE id = ?
    `);

    let newRefundId;
    try {
        db.transaction(() => {
            const result = insertRefund.run(
                reference,
                saleId,
                req.user.id,
                subtotalCents,
                vatCents,
                totalCents,
                reason && reason.trim() ? reason.trim() : null,
                note && note.trim() ? note.trim() : null
            );

            newRefundId = result.lastInsertRowid;

            for (const line of computedLines) {
                insertItem.run(
                    newRefundId,
                    line.original_sale_item_id,
                    line.product_id,
                    line.product_name,
                    line.product_sku,
                    line.quantity_refunded,
                    line.unit_price_cents,
                    line.line_subtotal_cents,
                    line.vat_rate_percent,
                    line.line_vat_cents,
                    line.line_total_cents
                );

                incrementStock.run(line.quantity_refunded, line.product_id);
            }
        })();

        req.flash(
            "success",
            `Refund ${reference} posted — ${computedLines.length} item(s), total ${formatRand(totalCents)}.`
        );
        res.redirect(`/returns/${newRefundId}`);
    } catch (err) {
        console.error("Error posting refund:", err);
        req.flash("error", "Could not post refund: " + err.message);
        res.redirect(`/returns/from-sale/${saleId}`);
    }
});


// =====================================================
// GET /returns/:id — view a posted refund (read-only)
// =====================================================
router.get("/returns/:id", requireLogin, (req, res) => {
    const refundId = parseInt(req.params.id, 10);

    const refund = db.prepare(`
        SELECT
            r.*,
            s.reference AS original_sale_reference,
            u.full_name AS cashier_name
        FROM refunds r
        LEFT JOIN sales s ON r.original_sale_id = s.id
        LEFT JOIN users u ON r.cashier_id = u.id
        WHERE r.id = ?
    `).get(refundId);

    if (!refund) {
        return res.status(404).render("error", {
            title:   "Refund not found",
            message: `No refund with ID ${refundId}.`,
        });
    }

    const items = db.prepare(`
        SELECT *
        FROM refund_items
        WHERE refund_id = ?
        ORDER BY id ASC
    `).all(refundId);

    res.render("returns-detail", {
        title:      `Refund ${refund.reference}`,
        active:     "returns",
        refund:     refund,
        items:      items,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


module.exports = router;