// =====================================================
// Supermarket POS — Till routes
// =====================================================
// Routes for the cashier-facing till screen plus
// the JSON APIs it talks to.
//
//   GET  /pos                       — render the till screen
//   GET  /api/products/search?q=    — search the product catalogue
//   POST /api/sales                 — submit a completed sale
//
// Available to: cashiers AND managers (the till is the
// shop's primary daily-use page).
// =====================================================

const express = require("express");
const db = require("../data/db");
const helpers = require("../middleware/helpers");
const { requireLogin } = require("../middleware/auth");

const router = express.Router();


// =====================================================
// GET /pos — Render the till
// =====================================================
router.get("/pos", requireLogin, (req, res) => {
    res.render("pos", {
        title:  "Till",
        active: "pos",
    });
});


// =====================================================
// GET /api/products/search
// =====================================================
// Returns a JSON list of products matching the query.
// Used by the till's search box for live filtering.
//
// Query param:
//   q   — search term (matches name, sku, or barcode)
//
// Returns max 60 results to keep responses fast.
// =====================================================
router.get("/api/products/search", requireLogin, (req, res) => {
    const q = (req.query.q || "").trim();

    let products;

    if (q === "") {
        // No query — return the most "active" products (recent/in-stock)
        products = db.prepare(`
            SELECT
                p.id,
                p.sku,
                p.barcode,
                p.name,
                p.price_cents,
                p.stock_qty,
                v.rate_percent AS vat_rate,
                v.code AS vat_code
            FROM products p
            JOIN vat_categories v ON v.id = p.vat_category_id
            WHERE p.is_active = 1
            ORDER BY p.name
            LIMIT 60
        `).all();
    } else {
        // Match against name, sku, or barcode using LIKE for flexibility
        const like = `%${q}%`;
        products = db.prepare(`
            SELECT
                p.id,
                p.sku,
                p.barcode,
                p.name,
                p.price_cents,
                p.stock_qty,
                v.rate_percent AS vat_rate,
                v.code AS vat_code
            FROM products p
            JOIN vat_categories v ON v.id = p.vat_category_id
            WHERE p.is_active = 1
              AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
            ORDER BY p.name
            LIMIT 60
        `).all(like, like, like);
    }

    // Format prices for display, but keep raw cents for math
    const formatted = products.map(p => ({
        id:           p.id,
        sku:          p.sku,
        barcode:      p.barcode,
        name:         p.name,
        price_cents:  p.price_cents,
        price_display: helpers.formatRand(p.price_cents),
        stock_qty:    p.stock_qty,
        vat_rate:     p.vat_rate,
        vat_code:     p.vat_code,
    }));

    res.json({ products: formatted });
});


// =====================================================
// POST /api/sales — Submit a completed sale
// =====================================================
// Request body:
//   {
//     items: [
//       { product_id: 1, quantity: 2 },
//       { product_id: 5, quantity: 1 },
//       ...
//     ],
//     payment_method: "cash" | "card" | "mobile"
//   }
//
// CRITICAL SECURITY PATTERN:
// We do NOT trust prices or VAT from the client. We
// re-fetch every product from the database and
// recalculate everything server-side.
//
// All inserts happen inside a database transaction
// so the sale either fully commits or fully rolls back.
// =====================================================
router.post("/api/sales", requireLogin, (req, res) => {
    const { items, payment_method } = req.body;

    // ----- Validate the request structure -----
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            error: "Sale must include at least one item.",
        });
    }

    const validPaymentMethods = ["cash", "card", "mobile"];
    const paymentMethod = validPaymentMethods.includes(payment_method)
        ? payment_method
        : "cash";

    // ----- Look up each product fresh from the database -----
    const lineCalculations = [];
    for (const item of items) {
        const productId = parseInt(item.product_id, 10);
        const quantity  = parseInt(item.quantity, 10);

        if (!productId || !quantity || quantity < 1) {
            return res.status(400).json({
                error: `Invalid item: product_id=${item.product_id}, quantity=${item.quantity}`,
            });
        }

        const product = db.prepare(`
            SELECT
                p.id,
                p.sku,
                p.name,
                p.price_cents,
                p.stock_qty,
                p.is_active,
                v.rate_percent AS vat_rate
            FROM products p
            JOIN vat_categories v ON v.id = p.vat_category_id
            WHERE p.id = ?
        `).get(productId);

        if (!product || !product.is_active) {
            return res.status(400).json({
                error: `Product not found or no longer available: ID ${productId}`,
            });
        }

        if (product.stock_qty < quantity) {
            return res.status(400).json({
                error: `Not enough stock for ${product.name}. Only ${product.stock_qty} left.`,
            });
        }

        // Calculate VAT for this line using our helper
        const calc = helpers.calculateLineVat(
            product.price_cents,
            quantity,
            product.vat_rate
        );

        lineCalculations.push({
            product_id:          product.id,
            product_name:        product.name,
            product_sku:         product.sku,
            quantity:            quantity,
            unit_price_cents:    product.price_cents,
            line_subtotal_cents: calc.lineSubtotalCents,
            vat_rate_percent:    product.vat_rate,
            line_vat_cents:      calc.lineVatCents,
            line_total_cents:    calc.lineTotalCents,
        });
    }

    // ----- Aggregate the sale totals -----
    const subtotalCents = lineCalculations.reduce((sum, l) => sum + l.line_subtotal_cents, 0);
    const vatCents      = lineCalculations.reduce((sum, l) => sum + l.line_vat_cents, 0);
    const totalCents    = lineCalculations.reduce((sum, l) => sum + l.line_total_cents, 0);

    const reference = helpers.generateSaleReference();

    // ----- Execute the sale as a single atomic transaction -----
    const insertSale = db.prepare(`
        INSERT INTO sales (reference, cashier_id, subtotal_cents, vat_cents, total_cents, payment_method)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertSaleItem = db.prepare(`
        INSERT INTO sale_items (
            sale_id, product_id, product_name, product_sku, quantity,
            unit_price_cents, line_subtotal_cents, vat_rate_percent,
            line_vat_cents, line_total_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
        UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?
    `);

    let saleId;

    try {
        db.transaction(() => {
            const result = insertSale.run(
                reference,
                req.user.id,
                subtotalCents,
                vatCents,
                totalCents,
                paymentMethod
            );
            saleId = result.lastInsertRowid;

            for (const line of lineCalculations) {
                insertSaleItem.run(
                    saleId,
                    line.product_id,
                    line.product_name,
                    line.product_sku,
                    line.quantity,
                    line.unit_price_cents,
                    line.line_subtotal_cents,
                    line.vat_rate_percent,
                    line.line_vat_cents,
                    line.line_total_cents
                );

                updateStock.run(line.quantity, line.product_id);
            }
        })();
    } catch (err) {
        console.error("Sale transaction failed:", err);
        return res.status(500).json({
            error: "Sale could not be completed. Please try again.",
        });
    }

    // ----- Return the receipt -----
    res.json({
        sale: {
            id:             saleId,
            reference:      reference,
            cashier:        req.user.full_name,
            created_at:     new Date().toISOString(),
            items:          lineCalculations.map(l => ({
                name:          l.product_name,
                sku:           l.product_sku,
                quantity:      l.quantity,
                unit_price:    helpers.formatRand(l.unit_price_cents),
                line_total:    helpers.formatRand(l.line_total_cents),
                vat_rate:      l.vat_rate_percent,
            })),
            subtotal:       helpers.formatRand(subtotalCents),
            vat:            helpers.formatRand(vatCents),
            total:          helpers.formatRand(totalCents),
            payment_method: paymentMethod,
        },
    });
});


module.exports = router;