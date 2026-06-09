// =====================================================
// Supermarket POS — Public Shop Routes
// =====================================================
// Customer-facing routes for the online storefront.
// NO authentication required — anyone can browse.
//
//   GET  /shop                — landing page
//   GET  /shop/products       — browse / search all products
//
// More routes (cart, checkout, order confirmation) will
// be added in the next session.
//
// Public means: no requireLogin/requireManager middleware.
// =====================================================

const express = require("express");
const db = require("../data/db");
const { formatRand } = require("../middleware/helpers");
const shop = require("../data/shop.json");

const router = express.Router();


// -----------------------------------------------------
// Helper: shared template variables for all shop pages
// -----------------------------------------------------
// Customer-facing pages don't have a logged-in user,
// so we don't pass currentUser. Instead we provide
// the shop config (name, address, etc.) for the layout.
// -----------------------------------------------------
function shopLocals(extra = {}) {
    return Object.assign({
        shop:       shop,
        formatRand: formatRand,
    }, extra);
}


// =====================================================
// GET /shop — landing page
// =====================================================
// Shows a welcome message, the shop's basic info,
// and a few featured products to entice browsing.
// =====================================================
router.get("/shop", (req, res) => {
    // Fetch 6 random products that are in stock — featured selection
    const featured = db.prepare(`
        SELECT
            p.id,
            p.sku,
            p.name,
            p.price_cents,
            p.stock_qty,
            v.rate_percent AS vat_rate
        FROM products p
        JOIN vat_categories v ON v.id = p.vat_category_id
        WHERE p.is_active = 1 AND p.stock_qty > 0
        ORDER BY RANDOM()
        LIMIT 6
    `).all();

    res.render("shop-home", shopLocals({
        title:    `Welcome to ${shop.name}`,
        featured: featured,
    }));
});


// =====================================================
// GET /shop/products — browse all products
// =====================================================
// Public catalogue. Supports a search query in ?q=
// Shows products with stock counts so customers know
// what's available.
// =====================================================
router.get("/shop/products", (req, res) => {
    const q = (req.query.q || "").trim();

    let products;

    if (q === "") {
        // No search — show all active products with stock
        products = db.prepare(`
            SELECT
                p.id,
                p.sku,
                p.name,
                p.price_cents,
                p.stock_qty,
                v.rate_percent AS vat_rate
            FROM products p
            JOIN vat_categories v ON v.id = p.vat_category_id
            WHERE p.is_active = 1
            ORDER BY p.name ASC
        `).all();
    } else {
        // Search by name, SKU, or barcode
        const like = `%${q}%`;
        products = db.prepare(`
            SELECT
                p.id,
                p.sku,
                p.name,
                p.price_cents,
                p.stock_qty,
                v.rate_percent AS vat_rate
            FROM products p
            JOIN vat_categories v ON v.id = p.vat_category_id
            WHERE p.is_active = 1
              AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
            ORDER BY p.name ASC
        `).all(like, like, like);
    }

    res.render("shop-products", shopLocals({
        title:    q ? `Search: ${q}` : "All products",
        q:        q,
        products: products,
    }));
});


module.exports = router;