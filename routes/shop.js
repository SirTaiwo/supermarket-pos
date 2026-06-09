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
const { formatRand, generateOrderReference } = require("../middleware/helpers");
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

// -----------------------------------------------------
// Helper: get cart from session (creating empty if needed)
// -----------------------------------------------------
function getCart(req) {
    if (!req.session.cart || !Array.isArray(req.session.cart.items)) {
        req.session.cart = { items: [] };
    }
    return req.session.cart;
}


// -----------------------------------------------------
// Helper: calculate a hydrated cart from current DB state
// -----------------------------------------------------
// Given a cart from session (just product IDs and qty),
// fetch fresh product data from DB and compute totals.
// Returns:
//   {
//     lines: [{ product details + quantity + line totals }],
//     subtotal_cents,
//     vat_cents,
//     total_cents,
//     total_items (count),
//     warnings: [list of strings]  // e.g. items out of stock
//   }
// -----------------------------------------------------
function calculateCart(cart) {
    const lines = [];
    const warnings = [];
    let subtotalCents = 0;
    let vatCents = 0;
    let totalCents = 0;
    let totalItems = 0;

    for (const item of cart.items) {
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
        `).get(item.product_id);

        if (!product || !product.is_active) {
            warnings.push(`A product in your cart is no longer available and has been removed.`);
            continue;  // Skip — don't include in lines
        }

        let qty = parseInt(item.quantity, 10);
        if (!qty || qty < 1) continue;

        // Cap quantity at available stock
        if (qty > product.stock_qty) {
            warnings.push(
                `Only ${product.stock_qty} of "${product.name}" available — quantity reduced.`
            );
            qty = product.stock_qty;
        }

        if (qty < 1) continue;  // Out of stock entirely

        const lineTotal = product.price_cents * qty;
        // VAT is INCLUSIVE in shop prices (back-calculated)
        const lineVat = Math.round((lineTotal * product.vat_rate) / (100 + product.vat_rate));
        const lineSubtotal = lineTotal - lineVat;

        lines.push({
            product_id:          product.id,
            sku:                 product.sku,
            name:                product.name,
            unit_price_cents:    product.price_cents,
            stock_qty:           product.stock_qty,
            quantity:            qty,
            vat_rate_percent:    product.vat_rate,
            line_subtotal_cents: lineSubtotal,
            line_vat_cents:      lineVat,
            line_total_cents:    lineTotal,
        });

        subtotalCents += lineSubtotal;
        vatCents      += lineVat;
        totalCents    += lineTotal;
        totalItems    += qty;
    }

    return {
        lines,
        subtotal_cents: subtotalCents,
        vat_cents:      vatCents,
        total_cents:    totalCents,
        total_items:    totalItems,
        warnings:       warnings,
    };
}


// -----------------------------------------------------
// Middleware: make cart count available to ALL shop views
// -----------------------------------------------------
// So the "🛒 Cart (2)" badge in the topbar always shows
// the right count, on every page.
// -----------------------------------------------------
router.use((req, res, next) => {
    const cart = getCart(req);
    const totalItems = cart.items.reduce(
        (sum, item) => sum + (parseInt(item.quantity, 10) || 0),
        0
    );
    res.locals.cartCount = totalItems;
    next();
});


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

// =====================================================
// GET /shop/cart — view the cart
// =====================================================
router.get("/shop/cart", (req, res) => {
    const cart = getCart(req);
    const hydrated = calculateCart(cart);

    // If items were dropped/adjusted during hydration, persist
    // the corrected cart back to the session
    req.session.cart = {
        items: hydrated.lines.map(line => ({
            product_id: line.product_id,
            quantity:   line.quantity,
        })),
    };

    res.render("shop-cart", shopLocals({
        title:    "Your cart",
        cart:     hydrated,
    }));
});


// =====================================================
// POST /shop/cart/add — add a product to cart
// =====================================================
router.post("/shop/cart/add", (req, res) => {
    const productId = parseInt(req.body.product_id, 10);
    const quantity  = parseInt(req.body.quantity || "1", 10);

    if (!productId || quantity < 1) {
        return res.redirect("/shop/products");
    }

    // Look up product to validate it exists and is active
    const product = db.prepare(`
        SELECT id, name, stock_qty, is_active
        FROM products
        WHERE id = ?
    `).get(productId);

    if (!product || !product.is_active) {
        req.flash("error", "That product is no longer available.");
        return res.redirect("/shop/products");
    }

    if (product.stock_qty < 1) {
        req.flash("error", `${product.name} is out of stock.`);
        return res.redirect("/shop/products");
    }

    const cart = getCart(req);

    // Check if already in cart — if so, increment
    const existing = cart.items.find(item => item.product_id === productId);
    if (existing) {
        const newQty = existing.quantity + quantity;
        if (newQty > product.stock_qty) {
            req.flash(
                "error",
                `Can't add more — only ${product.stock_qty} of ${product.name} in stock.`
            );
            return res.redirect("/shop/cart");
        }
        existing.quantity = newQty;
    } else {
        cart.items.push({
            product_id: productId,
            quantity:   Math.min(quantity, product.stock_qty),
        });
    }

    req.session.cart = cart;
    req.flash("success", `Added ${product.name} to cart.`);
    res.redirect("/shop/cart");
});


// =====================================================
// POST /shop/cart/update — change qty for an item (0 removes)
// =====================================================
router.post("/shop/cart/update", (req, res) => {
    const productId = parseInt(req.body.product_id, 10);
    const quantity  = parseInt(req.body.quantity, 10);

    if (!productId) {
        return res.redirect("/shop/cart");
    }

    const cart = getCart(req);

    if (!quantity || quantity < 1) {
        // Remove the item
        cart.items = cart.items.filter(item => item.product_id !== productId);
        req.session.cart = cart;
        return res.redirect("/shop/cart");
    }

    // Validate stock
    const product = db.prepare(`
        SELECT name, stock_qty
        FROM products
        WHERE id = ? AND is_active = 1
    `).get(productId);

    if (!product) {
        cart.items = cart.items.filter(item => item.product_id !== productId);
        req.session.cart = cart;
        return res.redirect("/shop/cart");
    }

    const cappedQty = Math.min(quantity, product.stock_qty);

    const existing = cart.items.find(item => item.product_id === productId);
    if (existing) {
        existing.quantity = cappedQty;
    }

    req.session.cart = cart;
    res.redirect("/shop/cart");
});


// =====================================================
// POST /shop/cart/clear — clear the entire cart
// =====================================================
router.post("/shop/cart/clear", (req, res) => {
    req.session.cart = { items: [] };
    req.flash("success", "Cart cleared.");
    res.redirect("/shop/cart");
});

// =====================================================
// GET /shop/checkout — checkout form
// =====================================================
// Shows the final cart review with customer detail
// form. Re-hydrates the cart against current DB state.
// =====================================================
router.get("/shop/checkout", (req, res) => {
    const cart = getCart(req);
    const hydrated = calculateCart(cart);

    // Persist any cart corrections back to session
    req.session.cart = {
        items: hydrated.lines.map(line => ({
            product_id: line.product_id,
            quantity:   line.quantity,
        })),
    };

    if (hydrated.lines.length === 0) {
        req.flash("error", "Your cart is empty. Add some products before checkout.");
        return res.redirect("/shop/products");
    }

    res.render("shop-checkout", shopLocals({
        title: "Checkout",
        cart:  hydrated,
    }));
});


// =====================================================
// POST /shop/orders — submit the order
// =====================================================
// Atomic:
//   1. Re-validate cart against DB (stock + active)
//   2. Re-calculate totals server-side
//   3. Insert online_orders header
//   4. Insert online_order_items rows
//   5. Clear the cart
//   6. Redirect to confirmation
//
// We do NOT decrement stock here — stock is decremented
// when cashier converts the order at the till.
// =====================================================
router.post("/shop/orders", (req, res) => {
    const { customer_name, customer_phone, customer_note } = req.body;

    // ----- Validate customer details -----
    const errors = [];
    const name  = (customer_name  || "").trim();
    const phone = (customer_phone || "").trim();
    const note  = (customer_note  || "").trim();

    if (!name)             errors.push("Please enter your name.");
    if (name.length > 100) errors.push("Name is too long (max 100 characters).");

    if (!phone)            errors.push("Please enter your phone number.");
    // Light validation — accepts +, digits, spaces, dashes, brackets
    if (phone && !/^[\d\s+\-()]{7,20}$/.test(phone)) {
        errors.push("Phone number doesn't look right. Use digits and +, spaces, or dashes.");
    }
    if (note.length > 500) errors.push("Note is too long (max 500 characters).");

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect("/shop/checkout");
    }

    // ----- Re-validate and re-hydrate the cart -----
    const cart = getCart(req);
    const hydrated = calculateCart(cart);

    if (hydrated.lines.length === 0) {
        req.flash("error", "Your cart is empty.");
        return res.redirect("/shop/products");
    }

    // If anything in the cart had to be adjusted/dropped during
    // hydration (stock changed, product deactivated), reject the
    // checkout — make the customer review the new state.
    if (hydrated.warnings.length > 0) {
        req.flash("error",
            "Some items in your cart changed (stock or availability). Please review your cart before checking out."
        );
        return res.redirect("/shop/cart");
    }

    // ----- Atomic order creation -----
    const reference = generateOrderReference(db);

    const insertOrder = db.prepare(`
        INSERT INTO online_orders (
            reference,
            customer_name, customer_phone, customer_note,
            subtotal_cents, vat_cents, total_cents,
            status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const insertOrderItem = db.prepare(`
        INSERT INTO online_order_items (
            order_id, product_id, product_name, product_sku,
            quantity, unit_price_cents,
            line_subtotal_cents, vat_rate_percent,
            line_vat_cents, line_total_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let orderId;

    try {
        db.transaction(() => {
            const result = insertOrder.run(
                reference,
                name,
                phone,
                note || null,
                hydrated.subtotal_cents,
                hydrated.vat_cents,
                hydrated.total_cents
            );
            orderId = result.lastInsertRowid;

            for (const line of hydrated.lines) {
                insertOrderItem.run(
                    orderId,
                    line.product_id,
                    line.name,
                    line.sku,
                    line.quantity,
                    line.unit_price_cents,
                    line.line_subtotal_cents,
                    line.vat_rate_percent,
                    line.line_vat_cents,
                    line.line_total_cents
                );
            }
        })();
    } catch (err) {
        console.error("Order creation failed:", err);
        req.flash("error", "We couldn't place your order. Please try again.");
        return res.redirect("/shop/checkout");
    }

    // Clear the cart now that order is placed
    req.session.cart = { items: [] };

    // Redirect to the confirmation page using the public reference
    res.redirect(`/shop/orders/${reference}`);
});


// =====================================================
// GET /shop/orders/:reference — order confirmation
// =====================================================
// Public, bookmarkable confirmation page. Customer can
// share/screenshot/return to this URL. No authentication
// required — anyone with the reference can view it.
// =====================================================
router.get("/shop/orders/:reference", (req, res) => {
    const reference = req.params.reference;

    const order = db.prepare(`
        SELECT *
        FROM online_orders
        WHERE reference = ?
    `).get(reference);

    if (!order) {
        return res.status(404).render("error", {
            title:   "Order not found",
            message: `No order with reference "${reference}".`,
        });
    }

    const items = db.prepare(`
        SELECT *
        FROM online_order_items
        WHERE order_id = ?
        ORDER BY id ASC
    `).all(order.id);

    res.render("shop-order-confirmation", shopLocals({
        title: `Order ${order.reference}`,
        order: order,
        items: items,
    }));
});


module.exports = router;