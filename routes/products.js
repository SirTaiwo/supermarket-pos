// =====================================================
// Supermarket POS — Products management routes
// =====================================================
// Manager-only catalog management.
//
//   GET  /products              — list all products
//   GET  /products/new          — form to add a new product
//   POST /products              — create a new product
//   GET  /products/:id/edit     — form to edit a product
//   POST /products/:id          — update an existing product
//   POST /products/:id/toggle   — activate/deactivate (soft delete)
// =====================================================

const express = require("express");
const db = require("../data/db");
const helpers = require("../middleware/helpers");
const { requireManager } = require("../middleware/auth");

const router = express.Router();


// =====================================================
// GET /products — list all products (active and inactive)
// =====================================================
router.get("/products", requireManager, (req, res) => {
    const products = db.prepare(`
        SELECT
            p.id,
            p.sku,
            p.barcode,
            p.name,
            p.price_cents,
            p.stock_qty,
            p.is_active,
            v.code AS vat_code,
            v.rate_percent AS vat_rate
        FROM products p
        JOIN vat_categories v ON v.id = p.vat_category_id
        ORDER BY p.is_active DESC, p.name ASC
    `).all();

    // Pre-format prices for display
    const formattedProducts = products.map(p => ({
        ...p,
        price_display: helpers.formatRand(p.price_cents),
        stock_low:     p.stock_qty <= 5 && p.is_active,
    }));

    res.render("products", {
        title:    "Products",
        active:   "products",
        products: formattedProducts,
    });
});


// =====================================================
// GET /products/new — form to add a new product
// =====================================================
router.get("/products/new", requireManager, (req, res) => {
    const vatCategories = db.prepare(
        "SELECT id, code, name, rate_percent FROM vat_categories ORDER BY id"
    ).all();

    res.render("products-form", {
        title:         "Add product",
        active:        "products",
        product:       null,           // null = new product
        vatCategories: vatCategories,
        formAction:    "/products",
        formTitle:     "Add a new product",
        submitLabel:   "Add product",
    });
});


// =====================================================
// POST /products — create a new product
// =====================================================
router.post("/products", requireManager, (req, res) => {
    const {
        sku, barcode, name, description,
        price_rands, cost_rands, vat_category_id, stock_qty,
    } = req.body;

    // ----- Validation -----
    const errors = [];

    if (!sku || !sku.trim()) errors.push("SKU is required.");
    if (!name || !name.trim()) errors.push("Name is required.");
    if (!vat_category_id) errors.push("VAT category is required.");

    const priceCents = Math.round(parseFloat(price_rands) * 100);
    if (isNaN(priceCents) || priceCents < 0) {
        errors.push("Price must be a positive number.");
    }

    const costCents = cost_rands && cost_rands.trim()
        ? Math.round(parseFloat(cost_rands) * 100)
        : null;
    if (costCents !== null && (isNaN(costCents) || costCents < 0)) {
        errors.push("Cost must be a positive number.");
    }

    const stockQty = parseInt(stock_qty, 10) || 0;
    if (stockQty < 0) {
        errors.push("Stock quantity cannot be negative.");
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect("/products/new");
    }

    // ----- Insert -----
    try {
        db.prepare(`
            INSERT INTO products
                (sku, barcode, name, description, price_cents, cost_cents,
                 vat_category_id, stock_qty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            sku.trim(),
            barcode && barcode.trim() ? barcode.trim() : null,
            name.trim(),
            description && description.trim() ? description.trim() : null,
            priceCents,
            costCents,
            parseInt(vat_category_id, 10),
            stockQty
        );

        req.flash("success", `Product "${name}" added.`);
        res.redirect("/products");
    } catch (err) {
        console.error("Error inserting product:", err);
        if (err.message.includes("UNIQUE constraint failed")) {
            req.flash("error", "A product with that SKU or barcode already exists.");
        } else {
            req.flash("error", "Could not add product: " + err.message);
        }
        res.redirect("/products/new");
    }
});


// =====================================================
// GET /products/:id/edit — form to edit a product
// =====================================================
router.get("/products/:id/edit", requireManager, (req, res) => {
    const productId = parseInt(req.params.id, 10);

    const product = db.prepare(
        "SELECT * FROM products WHERE id = ?"
    ).get(productId);

    if (!product) {
        return res.status(404).render("error", {
            title: "Product not found",
            message: `No product with ID ${productId}.`,
        });
    }

    const vatCategories = db.prepare(
        "SELECT id, code, name, rate_percent FROM vat_categories ORDER BY id"
    ).all();

    res.render("products-form", {
        title:         "Edit product",
        active:        "products",
        product:       product,
        vatCategories: vatCategories,
        formAction:    `/products/${product.id}`,
        formTitle:     `Edit: ${product.name}`,
        submitLabel:   "Save changes",
    });
});


// =====================================================
// POST /products/:id — update an existing product
// =====================================================
router.post("/products/:id", requireManager, (req, res) => {
    const productId = parseInt(req.params.id, 10);

    const product = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
    if (!product) {
        req.flash("error", "Product not found.");
        return res.redirect("/products");
    }

    const {
        sku, barcode, name, description,
        price_rands, cost_rands, vat_category_id, stock_qty,
    } = req.body;

    // ----- Validation (same as create) -----
    const errors = [];

    if (!sku || !sku.trim()) errors.push("SKU is required.");
    if (!name || !name.trim()) errors.push("Name is required.");
    if (!vat_category_id) errors.push("VAT category is required.");

    const priceCents = Math.round(parseFloat(price_rands) * 100);
    if (isNaN(priceCents) || priceCents < 0) {
        errors.push("Price must be a positive number.");
    }

    const costCents = cost_rands && cost_rands.trim()
        ? Math.round(parseFloat(cost_rands) * 100)
        : null;
    if (costCents !== null && (isNaN(costCents) || costCents < 0)) {
        errors.push("Cost must be a positive number.");
    }

    const stockQty = parseInt(stock_qty, 10) || 0;
    if (stockQty < 0) {
        errors.push("Stock quantity cannot be negative.");
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect(`/products/${productId}/edit`);
    }

    // ----- Update -----
    try {
        db.prepare(`
            UPDATE products SET
                sku = ?,
                barcode = ?,
                name = ?,
                description = ?,
                price_cents = ?,
                cost_cents = ?,
                vat_category_id = ?,
                stock_qty = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `).run(
            sku.trim(),
            barcode && barcode.trim() ? barcode.trim() : null,
            name.trim(),
            description && description.trim() ? description.trim() : null,
            priceCents,
            costCents,
            parseInt(vat_category_id, 10),
            stockQty,
            productId
        );

        req.flash("success", `Product "${name}" updated.`);
        res.redirect("/products");
    } catch (err) {
        console.error("Error updating product:", err);
        if (err.message.includes("UNIQUE constraint failed")) {
            req.flash("error", "Another product already has that SKU or barcode.");
        } else {
            req.flash("error", "Could not update product: " + err.message);
        }
        res.redirect(`/products/${productId}/edit`);
    }
});


// =====================================================
// POST /products/:id/toggle — activate / deactivate
// =====================================================
// We never hard-delete products. Setting is_active = 0
// hides them from the till but preserves the historical
// sales records that reference them.
// =====================================================
router.post("/products/:id/toggle", requireManager, (req, res) => {
    const productId = parseInt(req.params.id, 10);

    const product = db.prepare(
        "SELECT id, name, is_active FROM products WHERE id = ?"
    ).get(productId);

    if (!product) {
        req.flash("error", "Product not found.");
        return res.redirect("/products");
    }

    const newStatus = product.is_active ? 0 : 1;

    db.prepare(
        "UPDATE products SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newStatus, productId);

    const verb = newStatus ? "reactivated" : "deactivated";
    req.flash("success", `Product "${product.name}" ${verb}.`);
    res.redirect("/products");
});


module.exports = router;