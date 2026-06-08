// =====================================================
// Supermarket POS — Stock movements report
// =====================================================
// Manager-only unified view of all stock movements.
// Combines three sources of stock change:
//   - Sales (sale_items) — stock DECREASES
//   - GRNs (goods_received_items) — stock INCREASES
//   - Adjustments (stock_adjustments) — stock either way
//
// Supports filtering by:
//   - product (or "all")
//   - date range (from / to)
//   - movement types (sales / grns / adjustments)
//
//   GET  /reports/stock-movements
// =====================================================

const express = require("express");
const db = require("../data/db");
const { requireManager } = require("../middleware/auth");
const { formatRand, formatDate } = require("../middleware/helpers");

const router = express.Router();


// =====================================================
// GET /reports/stock-movements
// =====================================================
router.get("/reports/stock-movements", requireManager, (req, res) => {

    // ----- Parse filter parameters with safe defaults -----
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Default "from" = 7 days ago, "to" = today (ISO date strings)
    const dateFrom = req.query.from || sevenDaysAgo.toISOString().slice(0, 10);
    const dateTo   = req.query.to   || today.toISOString().slice(0, 10);

    // Convert to inclusive datetime ranges for SQL
    const dateFromSQL = `${dateFrom} 00:00:00`;
    const dateToSQL   = `${dateTo} 23:59:59`;

    // Product filter: "all" or a specific product_id
    const productFilter = req.query.product_id || "all";
    const productId = productFilter === "all" ? null : parseInt(productFilter, 10);

    // Movement type filters — default to all three on
    // (when no params are passed at all, show everything;
    //  when filters ARE passed, respect them strictly)
    const hasTypeParams = (
        req.query.types_sales !== undefined ||
        req.query.types_grns !== undefined ||
        req.query.types_adj !== undefined
    );

    const includeSales = hasTypeParams ? (req.query.types_sales === "1") : true;
    const includeGrns  = hasTypeParams ? (req.query.types_grns  === "1") : true;
    const includeAdj   = hasTypeParams ? (req.query.types_adj   === "1") : true;


    // ----- Fetch all active products for the filter dropdown -----
    const products = db.prepare(`
        SELECT id, sku, name, stock_qty
        FROM products
        ORDER BY name ASC
    `).all();


    // ----- Build the unified movements query using UNION ALL -----
    //
    // Each branch normalises to the same set of columns:
    //   when_at, movement_type, product_id, product_name,
    //   product_sku, quantity_change, reference, note, user_name
    //
    // We then ORDER the whole thing by when_at DESC for chronological display.
    // ---------------------------------------------------------

    const parts = [];
    const params = {};

    if (includeSales) {
        parts.push(`
            SELECT
                s.created_at         AS when_at,
                'SALE'               AS movement_type,
                si.product_id        AS product_id,
                si.product_name      AS product_name,
                si.product_sku       AS product_sku,
                -si.quantity         AS quantity_change,
                s.reference          AS reference,
                NULL                 AS note,
                u.full_name          AS user_name
            FROM sale_items si
            JOIN sales s   ON si.sale_id = s.id
            LEFT JOIN users u ON s.cashier_id = u.id
            WHERE s.created_at BETWEEN @dateFrom AND @dateTo
            ${productId ? "AND si.product_id = @productId" : ""}
        `);
    }

    if (includeGrns) {
        parts.push(`
            SELECT
                g.received_at        AS when_at,
                'GRN'                AS movement_type,
                gi.product_id        AS product_id,
                gi.product_name      AS product_name,
                gi.product_sku       AS product_sku,
                gi.quantity          AS quantity_change,
                g.reference          AS reference,
                g.notes              AS note,
                u.full_name          AS user_name
            FROM goods_received_items gi
            JOIN goods_received_notes g ON gi.grn_id = g.id
            LEFT JOIN users u ON g.received_by = u.id
            WHERE g.received_at BETWEEN @dateFrom AND @dateTo
            AND g.status = 'posted'
            ${productId ? "AND gi.product_id = @productId" : ""}
        `);
    }

    if (includeAdj) {
        parts.push(`
            SELECT
                a.created_at         AS when_at,
                'ADJ'                AS movement_type,
                a.product_id         AS product_id,
                a.product_name       AS product_name,
                a.product_sku        AS product_sku,
                a.quantity_change    AS quantity_change,
                a.reference          AS reference,
                a.note               AS note,
                u.full_name          AS user_name
            FROM stock_adjustments a
            LEFT JOIN users u ON a.adjusted_by = u.id
            WHERE a.created_at BETWEEN @dateFrom AND @dateTo
            ${productId ? "AND a.product_id = @productId" : ""}
        `);
    }

    params.dateFrom = dateFromSQL;
    params.dateTo   = dateToSQL;
    if (productId) params.productId = productId;

    let movements = [];
    let summary = {
        sales_units: 0,
        grns_units:  0,
        adj_positive_units: 0,
        adj_negative_units: 0,
        net_change: 0,
        total_rows: 0,
    };

    if (parts.length > 0) {
        const fullQuery = parts.join(" UNION ALL ") + " ORDER BY when_at DESC LIMIT 500";
        movements = db.prepare(fullQuery).all(params);

        // Calculate summary
        for (const m of movements) {
            const q = m.quantity_change;
            if (m.movement_type === "SALE") {
                summary.sales_units += Math.abs(q);   // q is negative; show magnitude
            } else if (m.movement_type === "GRN") {
                summary.grns_units += q;
            } else if (m.movement_type === "ADJ") {
                if (q > 0) {
                    summary.adj_positive_units += q;
                } else {
                    summary.adj_negative_units += Math.abs(q);
                }
            }
            summary.net_change += q;
            summary.total_rows += 1;
        }
    }


    // ----- Render -----
    res.render("stock-movements", {
        title:        "Stock movements",
        active:       "reports",
        products:     products,
        movements:    movements,
        summary:      summary,
        filters: {
            dateFrom:      dateFrom,
            dateTo:        dateTo,
            productFilter: productFilter,
            includeSales:  includeSales,
            includeGrns:   includeGrns,
            includeAdj:    includeAdj,
        },
        formatRand:   formatRand,
        formatDate:   formatDate,
    });
});


module.exports = router;