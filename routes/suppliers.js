// =====================================================
// Supermarket POS — Suppliers management routes
// =====================================================
// Manager-only supplier catalog management.
//
//   GET  /suppliers               — list all suppliers
//   GET  /suppliers/new           — form to add a new supplier
//   POST /suppliers               — create a new supplier
//   GET  /suppliers/:id/edit      — form to edit a supplier
//   POST /suppliers/:id           — update an existing supplier
//   POST /suppliers/:id/toggle    — activate/deactivate (soft delete)
// =====================================================

const express = require("express");
const db = require("../data/db");
const { requireManager } = require("../middleware/auth");

const router = express.Router();


// =====================================================
// GET /suppliers — list all suppliers
// =====================================================
router.get("/suppliers", requireManager, (req, res) => {
    const suppliers = db.prepare(`
        SELECT
            id,
            name,
            contact_person,
            phone,
            email,
            payment_terms,
            is_active,
            (SELECT COUNT(*) FROM goods_received_notes WHERE supplier_id = suppliers.id) AS grn_count
        FROM suppliers
        ORDER BY is_active DESC, name ASC
    `).all();

    res.render("suppliers", {
        title:     "Suppliers",
        active:    "suppliers",
        suppliers: suppliers,
    });
});


// =====================================================
// GET /suppliers/new — form to add a new supplier
// =====================================================
router.get("/suppliers/new", requireManager, (req, res) => {
    res.render("suppliers-form", {
        title:       "Add supplier",
        active:      "suppliers",
        supplier:    null,             // null = new supplier
        formAction:  "/suppliers",
        formTitle:   "Add a new supplier",
        submitLabel: "Add supplier",
    });
});


// =====================================================
// POST /suppliers — create a new supplier
// =====================================================
router.post("/suppliers", requireManager, (req, res) => {
    const {
        name, contact_person, phone, email, address,
        account_number, payment_terms, notes,
    } = req.body;

    // ----- Validation -----
    const errors = [];
    if (!name || !name.trim()) errors.push("Supplier name is required.");

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect("/suppliers/new");
    }

    try {
        db.prepare(`
            INSERT INTO suppliers
                (name, contact_person, phone, email, address,
                 account_number, payment_terms, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            name.trim(),
            contact_person && contact_person.trim() ? contact_person.trim() : null,
            phone && phone.trim() ? phone.trim() : null,
            email && email.trim() ? email.trim() : null,
            address && address.trim() ? address.trim() : null,
            account_number && account_number.trim() ? account_number.trim() : null,
            payment_terms && payment_terms.trim() ? payment_terms.trim() : null,
            notes && notes.trim() ? notes.trim() : null
        );

        req.flash("success", `Supplier "${name}" added.`);
        res.redirect("/suppliers");
    } catch (err) {
        console.error("Error inserting supplier:", err);
        req.flash("error", "Could not add supplier: " + err.message);
        res.redirect("/suppliers/new");
    }
});


// =====================================================
// GET /suppliers/:id/edit — form to edit a supplier
// =====================================================
router.get("/suppliers/:id/edit", requireManager, (req, res) => {
    const supplierId = parseInt(req.params.id, 10);

    const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId);

    if (!supplier) {
        return res.status(404).render("error", {
            title:   "Supplier not found",
            message: `No supplier with ID ${supplierId}.`,
        });
    }

    res.render("suppliers-form", {
        title:       "Edit supplier",
        active:      "suppliers",
        supplier:    supplier,
        formAction:  `/suppliers/${supplier.id}`,
        formTitle:   `Edit: ${supplier.name}`,
        submitLabel: "Save changes",
    });
});


// =====================================================
// POST /suppliers/:id — update an existing supplier
// =====================================================
router.post("/suppliers/:id", requireManager, (req, res) => {
    const supplierId = parseInt(req.params.id, 10);

    const existing = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(supplierId);
    if (!existing) {
        req.flash("error", "Supplier not found.");
        return res.redirect("/suppliers");
    }

    const {
        name, contact_person, phone, email, address,
        account_number, payment_terms, notes,
    } = req.body;

    const errors = [];
    if (!name || !name.trim()) errors.push("Supplier name is required.");

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect(`/suppliers/${supplierId}/edit`);
    }

    try {
        db.prepare(`
            UPDATE suppliers SET
                name            = ?,
                contact_person  = ?,
                phone           = ?,
                email           = ?,
                address         = ?,
                account_number  = ?,
                payment_terms   = ?,
                notes           = ?,
                updated_at      = datetime('now')
            WHERE id = ?
        `).run(
            name.trim(),
            contact_person && contact_person.trim() ? contact_person.trim() : null,
            phone && phone.trim() ? phone.trim() : null,
            email && email.trim() ? email.trim() : null,
            address && address.trim() ? address.trim() : null,
            account_number && account_number.trim() ? account_number.trim() : null,
            payment_terms && payment_terms.trim() ? payment_terms.trim() : null,
            notes && notes.trim() ? notes.trim() : null,
            supplierId
        );

        req.flash("success", `Supplier "${name}" updated.`);
        res.redirect("/suppliers");
    } catch (err) {
        console.error("Error updating supplier:", err);
        req.flash("error", "Could not update supplier: " + err.message);
        res.redirect(`/suppliers/${supplierId}/edit`);
    }
});


// =====================================================
// POST /suppliers/:id/toggle — activate / deactivate
// =====================================================
// Soft delete only. Deactivated suppliers no longer
// appear in active dropdowns but their historical GRNs
// remain intact.
// =====================================================
router.post("/suppliers/:id/toggle", requireManager, (req, res) => {
    const supplierId = parseInt(req.params.id, 10);

    const supplier = db.prepare(
        "SELECT id, name, is_active FROM suppliers WHERE id = ?"
    ).get(supplierId);

    if (!supplier) {
        req.flash("error", "Supplier not found.");
        return res.redirect("/suppliers");
    }

    const newStatus = supplier.is_active ? 0 : 1;

    db.prepare(
        "UPDATE suppliers SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newStatus, supplierId);

    const verb = newStatus ? "reactivated" : "deactivated";
    req.flash("success", `Supplier "${supplier.name}" ${verb}.`);
    res.redirect("/suppliers");
});


module.exports = router;