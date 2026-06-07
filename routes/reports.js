// =====================================================
// Supermarket POS — Reports routes
// =====================================================
// Manager-only daily sales reporting.
//
//   GET /reports/daily?date=YYYY-MM-DD   — daily summary
//
// The date parameter is optional; defaults to today.
// =====================================================

const express = require("express");
const db = require("../data/db");
const helpers = require("../middleware/helpers");
const { requireManager } = require("../middleware/auth");

const router = express.Router();


// -----------------------------------------------------
// Helper — get today's date as YYYY-MM-DD
// -----------------------------------------------------
function todayIso() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}


// =====================================================
// GET /reports/daily
// =====================================================
router.get("/reports/daily", requireManager, (req, res) => {
    // ----- Determine the date to report on -----
    const requestedDate = req.query.date || todayIso();

    // Validate the date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
        req.flash("error", "Invalid date format. Use YYYY-MM-DD.");
        return res.redirect("/reports/daily");
    }

    // SQLite stores datetime as 'YYYY-MM-DD HH:MM:SS' so we
    // use date(created_at) = 'YYYY-MM-DD' to filter to one day.

    // ----- 1. Headline numbers -----
    const headline = db.prepare(`
        SELECT
            COUNT(*)              AS transaction_count,
            COALESCE(SUM(subtotal_cents), 0) AS subtotal_cents,
            COALESCE(SUM(vat_cents), 0)      AS vat_cents,
            COALESCE(SUM(total_cents), 0)    AS total_cents
        FROM sales
        WHERE date(created_at) = ?
          AND status = 'completed'
    `).get(requestedDate);

    // ----- 2. Total items sold (sum of quantity across all sale_items) -----
    const itemsSold = db.prepare(`
        SELECT COALESCE(SUM(si.quantity), 0) AS items_count
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE date(s.created_at) = ?
          AND s.status = 'completed'
    `).get(requestedDate);

    // ----- 3. VAT breakdown by category -----
    const vatBreakdown = db.prepare(`
        SELECT
            CASE
                WHEN si.vat_rate_percent = 0 THEN 'Zero-rated / Exempt'
                ELSE 'Standard (' || si.vat_rate_percent || '%)'
            END AS category,
            COUNT(*)                          AS line_count,
            COALESCE(SUM(si.line_subtotal_cents), 0) AS net_cents,
            COALESCE(SUM(si.line_vat_cents), 0)      AS vat_cents,
            COALESCE(SUM(si.line_total_cents), 0)    AS gross_cents
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE date(s.created_at) = ?
          AND s.status = 'completed'
        GROUP BY category
        ORDER BY si.vat_rate_percent DESC
    `).all(requestedDate);

    // ----- 4. Top-selling products today -----
    const topSellers = db.prepare(`
        SELECT
            si.product_name,
            si.product_sku,
            SUM(si.quantity)            AS units_sold,
            SUM(si.line_total_cents)    AS revenue_cents
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE date(s.created_at) = ?
          AND s.status = 'completed'
        GROUP BY si.product_id, si.product_name, si.product_sku
        ORDER BY units_sold DESC
        LIMIT 10
    `).all(requestedDate);

    // ----- 5. Recent transactions on this day -----
    const transactions = db.prepare(`
        SELECT
            s.id,
            s.reference,
            s.subtotal_cents,
            s.vat_cents,
            s.total_cents,
            s.payment_method,
            s.created_at,
            u.full_name AS cashier_name,
            (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS item_lines,
            (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS units
        FROM sales s
        JOIN users u ON u.id = s.cashier_id
        WHERE date(s.created_at) = ?
          AND s.status = 'completed'
        ORDER BY s.created_at DESC
    `).all(requestedDate);

    // ----- Format everything for display -----
    res.render("reports/daily", {
        title:    "Daily report",
        active:   "reports",
        reportDate: requestedDate,
        isToday:    requestedDate === todayIso(),

        headline: {
            transaction_count: headline.transaction_count,
            items_sold:        itemsSold.items_count,
            subtotal_display:  helpers.formatRand(headline.subtotal_cents),
            vat_display:       helpers.formatRand(headline.vat_cents),
            total_display:     helpers.formatRand(headline.total_cents),
        },

        vatBreakdown: vatBreakdown.map(row => ({
            category:       row.category,
            line_count:     row.line_count,
            net_display:    helpers.formatRand(row.net_cents),
            vat_display:    helpers.formatRand(row.vat_cents),
            gross_display:  helpers.formatRand(row.gross_cents),
        })),

        topSellers: topSellers.map(row => ({
            product_name:    row.product_name,
            product_sku:     row.product_sku,
            units_sold:      row.units_sold,
            revenue_display: helpers.formatRand(row.revenue_cents),
        })),

        transactions: transactions.map(row => ({
            id:             row.id,
            reference:      row.reference,
            cashier_name:   row.cashier_name,
            subtotal_display: helpers.formatRand(row.subtotal_cents),
            vat_display:    helpers.formatRand(row.vat_cents),
            total_display:  helpers.formatRand(row.total_cents),
            payment_method: row.payment_method,
            item_lines:     row.item_lines,
            units:          row.units,
            time:           helpers.formatDate(row.created_at),
        })),
    });
});


module.exports = router;