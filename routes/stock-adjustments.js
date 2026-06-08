// =====================================================
// Supermarket POS — Stock adjustments routes
// =====================================================
// Manager-only stock adjustments management.
// Adjustments capture all internal stock changes —
// damage, expiry, theft, physical count variances, and
// found stock. Every adjustment requires a reason code.
//
//   GET  /stock-adjustments         — list all adjustments
//   GET  /stock-adjustments/new     — form to record an adjustment
//   POST /stock-adjustments         — submit (atomic stock update)
// =====================================================

const express = require("express");
const db = require("../data/db");
const { requireManager } = require("../middleware/auth");
const { formatRand, formatDate } = require("../middleware/helpers");

const router = express.Router();


// -----------------------------------------------------
// Helper: produce a sequential ADJ reference for today.
// Pattern matches GRN: ADJ-YYYYMMDD-NNN
// -----------------------------------------------------
function generateAdjustmentReference() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const prefix = `ADJ-${yyyy}${mm}${dd}-`;

    const row = db.prepare(`
        SELECT reference
        FROM stock_adjustments
        WHERE reference LIKE ?
        ORDER BY reference DESC
        LIMIT 1
    `).get(prefix + "%");

    let nextNumber = 1;
    if (row) {
        const parts = row.reference.split("-");
        const lastNum = parseInt(parts[parts.length - 1], 10);
        nextNumber = lastNum + 1;
    }

    return `${prefix}${String(nextNumber).padStart(3, "0")}`;
}


// =====================================================
// GET /stock-adjustments — list all adjustments
// =====================================================
router.get("/stock-adjustments", requireManager, (req, res) => {
    const adjustments = db.prepare(`
        SELECT
            a.id,
            a.reference,
            a.product_name,
            a.product_sku,
            a.quantity_change,
            a.before_qty,
            a.after_qty,
            a.note,
            a.created_at,
            r.code AS reason_code,
            r.name AS reason_name,
            r.direction AS reason_direction,
            u.full_name AS adjusted_by_name
        FROM stock_adjustments a
        LEFT JOIN stock_adjustment_reasons r ON a.reason_id = r.id
        LEFT JOIN users u ON a.adjusted_by = u.id
        ORDER BY a.created_at DESC
        LIMIT 100
    `).all();

    res.render("stock-adjustments", {
        title:       "Stock adjustments",
        active:      "stock-adjustments",
        adjustments: adjustments,
        formatDate:  formatDate,
    });
});


// =====================================================
// GET /stock-adjustments/new — form to record an adjustment
// =====================================================
router.get("/stock-adjustments/new", requireManager, (req, res) => {
    // Active products only — we adjust real catalog items
    const products = db.prepare(`
        SELECT id, sku, name, stock_qty
        FROM products
        WHERE is_active = 1
        ORDER BY name ASC
    `).all();

    // All reasons (the lookup table)
    const reasons = db.prepare(`
        SELECT id, code, name, direction, description
        FROM stock_adjustment_reasons
        ORDER BY id ASC
    `).all();

    res.render("stock-adjustments-form", {
        title:    "Record stock adjustment",
        active:   "stock-adjustments",
        products: products,
        reasons:  reasons,
    });
});


// =====================================================
// POST /stock-adjustments — submit an adjustment (atomic)
// =====================================================
// Receives:
//   product_id        — required
//   reason_id         — required (must be a known reason)
//   quantity_change   — required, non-zero integer (can be + or -)
//                       NOTE: client sends signed integer (e.g. -4 for write-off)
//   note              — optional
//
// Validation rules:
//   - quantity_change must be non-zero
//   - new stock_qty (after applying change) must not go below 0
//   - reason.direction must agree with sign of quantity_change:
//       direction='negative' → quantity_change must be < 0
//       direction='positive' → quantity_change must be > 0
//       direction='either'   → any non-zero
//
// Atomic operations:
//   1. Look up product (lock its stock_qty snapshot)
//   2. Validate the change
//   3. Insert adjustment row (with before/after snapshots)
//   4. Update product.stock_qty
//   5. All in one transaction
// =====================================================
router.post("/stock-adjustments", requireManager, (req, res) => {
    const { product_id, reason_id, quantity_change, note } = req.body;

    // ----- Validation -----
    const errors = [];

    const productId = parseInt(product_id, 10);
    const reasonId  = parseInt(reason_id, 10);
    const qtyChange = parseInt(quantity_change, 10);

    if (!productId || isNaN(productId)) errors.push("Product is required.");
    if (!reasonId  || isNaN(reasonId))  errors.push("Reason is required.");

    if (isNaN(qtyChange) || qtyChange === 0) {
        errors.push("Quantity change must be a non-zero number.");
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect("/stock-adjustments/new");
    }

    // Look up product
    const product = db.prepare(`
        SELECT id, sku, name, stock_qty
        FROM products
        WHERE id = ? AND is_active = 1
    `).get(productId);

    if (!product) {
        req.flash("error", "Product not found or inactive.");
        return res.redirect("/stock-adjustments/new");
    }

    // Look up reason
    const reason = db.prepare(`
        SELECT id, code, name, direction
        FROM stock_adjustment_reasons
        WHERE id = ?
    `).get(reasonId);

    if (!reason) {
        req.flash("error", "Reason not found.");
        return res.redirect("/stock-adjustments/new");
    }

    // Reason direction must agree with sign
    if (reason.direction === "negative" && qtyChange > 0) {
        req.flash(
            "error",
            `Reason "${reason.name}" is for DECREASES — quantity must be negative.`
        );
        return res.redirect("/stock-adjustments/new");
    }
    if (reason.direction === "positive" && qtyChange < 0) {
        req.flash(
            "error",
            `Reason "${reason.name}" is for INCREASES — quantity must be positive.`
        );
        return res.redirect("/stock-adjustments/new");
    }

    // Calculate new stock and check not below zero
    const newStock = product.stock_qty + qtyChange;
    if (newStock < 0) {
        req.flash(
            "error",
            `Cannot reduce ${product.name} below zero. ` +
            `Current stock is ${product.stock_qty}, you tried to subtract ${Math.abs(qtyChange)}.`
        );
        return res.redirect("/stock-adjustments/new");
    }

    // ----- Atomic insert + stock update -----
    const reference = generateAdjustmentReference();

    const insertAdjustment = db.prepare(`
        INSERT INTO stock_adjustments
            (reference, product_id, product_name, product_sku,
             quantity_change, before_qty, after_qty,
             reason_id, note, adjusted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
        UPDATE products SET stock_qty = ? WHERE id = ?
    `);

    try {
        db.transaction(() => {
            insertAdjustment.run(
                reference,
                product.id,
                product.name,
                product.sku,
                qtyChange,
                product.stock_qty,
                newStock,
                reason.id,
                note && note.trim() ? note.trim() : null,
                req.user.id
            );

            updateStock.run(newStock, product.id);
        })();

        const verb = qtyChange > 0 ? "added" : "removed";
        req.flash(
            "success",
            `${reference} posted — ${Math.abs(qtyChange)} unit(s) ${verb} ` +
            `(${reason.code}). ${product.name} stock: ${product.stock_qty} → ${newStock}.`
        );
        res.redirect("/stock-adjustments");
    } catch (err) {
        console.error("Error posting adjustment:", err);
        req.flash("error", "Could not record adjustment: " + err.message);
        res.redirect("/stock-adjustments/new");
    }
});


module.exports = router;
