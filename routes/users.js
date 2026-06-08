// =====================================================
// Supermarket POS — User management routes
// =====================================================
// Manager-only user account management.
// Supports two roles: 'manager' and 'cashier'.
// Soft-delete only (is_active = 0) — never destroys
// users because sales reference cashier_id.
//
//   GET  /users                        — list all users
//   GET  /users/new                    — add user form
//   POST /users                        — create user
//   GET  /users/:id/edit               — edit user form
//   POST /users/:id                    — update user
//   POST /users/:id/toggle             — deactivate / reactivate
//   GET  /users/:id/reset-password     — reset password form
//   POST /users/:id/reset-password     — apply new password
// =====================================================

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../data/db");
const { requireManager } = require("../middleware/auth");
const { formatDate } = require("../middleware/helpers");

const router = express.Router();


// -----------------------------------------------------
// Helper: count active managers (used to prevent
// locking yourself out by demoting/deactivating the
// last manager)
// -----------------------------------------------------
function countActiveManagers() {
    const row = db.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'manager' AND is_active = 1"
    ).get();
    return row.n;
}


// =====================================================
// GET /users — list all users
// =====================================================
router.get("/users", requireManager, (req, res) => {
    const users = db.prepare(`
        SELECT
            u.id,
            u.username,
            u.full_name,
            u.role,
            u.is_active,
            u.created_at,
            (SELECT COUNT(*) FROM sales WHERE cashier_id = u.id) AS sales_count,
            (SELECT MAX(created_at) FROM sales WHERE cashier_id = u.id) AS last_active_at
        FROM users u
        ORDER BY u.is_active DESC, u.role ASC, u.full_name ASC
    `).all();

    res.render("users", {
        title:      "Users",
        active:     "users",
        users:      users,
        formatDate: formatDate,
    });
});


// =====================================================
// GET /users/new — add user form
// =====================================================
router.get("/users/new", requireManager, (req, res) => {
    res.render("users-form", {
        title:       "Add user",
        active:      "users",
        user:        null,           // null = new user
        formAction:  "/users",
        formTitle:   "Add a new user",
        submitLabel: "Create user",
    });
});


// =====================================================
// POST /users — create user
// =====================================================
router.post("/users", requireManager, (req, res) => {
    const { username, full_name, role, password, confirm_password } = req.body;

    // ----- Validation -----
    const errors = [];

    if (!username || !username.trim())     errors.push("Username is required.");
    if (!full_name || !full_name.trim())   errors.push("Full name is required.");
    if (!role || !["manager", "cashier"].includes(role)) {
        errors.push("Role must be 'manager' or 'cashier'.");
    }
    if (!password || password.length < 8)  errors.push("Password must be at least 8 characters.");
    if (password !== confirm_password)     errors.push("Passwords do not match.");

    if (username) {
        // Username uniqueness check (also enforced by DB but we want a nice error)
        const existing = db.prepare(
            "SELECT id FROM users WHERE username = ?"
        ).get(username.trim().toLowerCase());
        if (existing) errors.push("That username is already taken.");
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect("/users/new");
    }

    try {
        const passwordHash = bcrypt.hashSync(password, 10);
        db.prepare(`
            INSERT INTO users (username, password_hash, full_name, role)
            VALUES (?, ?, ?, ?)
        `).run(
            username.trim().toLowerCase(),
            passwordHash,
            full_name.trim(),
            role
        );

        req.flash("success", `User "${full_name}" created.`);
        res.redirect("/users");
    } catch (err) {
        console.error("Error creating user:", err);
        req.flash("error", "Could not create user: " + err.message);
        res.redirect("/users/new");
    }
});


// =====================================================
// GET /users/:id/edit — edit user form
// =====================================================
router.get("/users/:id/edit", requireManager, (req, res) => {
    const userId = parseInt(req.params.id, 10);

    const user = db.prepare(
        "SELECT id, username, full_name, role, is_active FROM users WHERE id = ?"
    ).get(userId);

    if (!user) {
        return res.status(404).render("error", {
            title:   "User not found",
            message: `No user with ID ${userId}.`,
        });
    }

    res.render("users-form", {
        title:       `Edit ${user.full_name}`,
        active:      "users",
        user:        user,
        formAction:  `/users/${user.id}`,
        formTitle:   `Edit: ${user.full_name}`,
        submitLabel: "Save changes",
    });
});


// =====================================================
// POST /users/:id — update user (name + role only)
// =====================================================
// Username is immutable (audit trail integrity).
// Password is changed via separate /reset-password flow.
// =====================================================
router.post("/users/:id", requireManager, (req, res) => {
    const userId = parseInt(req.params.id, 10);

    const existing = db.prepare(
        "SELECT id, username, full_name, role FROM users WHERE id = ?"
    ).get(userId);

    if (!existing) {
        req.flash("error", "User not found.");
        return res.redirect("/users");
    }

    const { full_name, role } = req.body;

    const errors = [];
    if (!full_name || !full_name.trim())   errors.push("Full name is required.");
    if (!role || !["manager", "cashier"].includes(role)) {
        errors.push("Role must be 'manager' or 'cashier'.");
    }

    // Prevent demoting the LAST active manager
    if (existing.role === "manager" && role === "cashier") {
        if (countActiveManagers() <= 1) {
            errors.push(
                "Cannot demote the last active manager. " +
                "Add another manager first."
            );
        }
    }

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect(`/users/${userId}/edit`);
    }

    try {
        db.prepare(`
            UPDATE users SET
                full_name = ?,
                role      = ?
            WHERE id = ?
        `).run(full_name.trim(), role, userId);

        req.flash("success", `User "${full_name}" updated.`);
        res.redirect("/users");
    } catch (err) {
        console.error("Error updating user:", err);
        req.flash("error", "Could not update user: " + err.message);
        res.redirect(`/users/${userId}/edit`);
    }
});


// =====================================================
// POST /users/:id/toggle — activate / deactivate
// =====================================================
router.post("/users/:id/toggle", requireManager, (req, res) => {
    const userId = parseInt(req.params.id, 10);

    const user = db.prepare(
        "SELECT id, username, full_name, role, is_active FROM users WHERE id = ?"
    ).get(userId);

    if (!user) {
        req.flash("error", "User not found.");
        return res.redirect("/users");
    }

    // Prevent deactivating yourself
    if (user.id === req.user.id) {
        req.flash("error", "You cannot deactivate your own account.");
        return res.redirect("/users");
    }

    const newStatus = user.is_active ? 0 : 1;

    // Prevent deactivating the LAST active manager
    if (user.role === "manager" && user.is_active && newStatus === 0) {
        if (countActiveManagers() <= 1) {
            req.flash(
                "error",
                "Cannot deactivate the last active manager. " +
                "Add another manager first."
            );
            return res.redirect("/users");
        }
    }

    db.prepare(
        "UPDATE users SET is_active = ? WHERE id = ?"
    ).run(newStatus, userId);

    const verb = newStatus ? "reactivated" : "deactivated";
    req.flash("success", `User "${user.full_name}" ${verb}.`);
    res.redirect("/users");
});


// =====================================================
// GET /users/:id/reset-password — reset password form
// =====================================================
router.get("/users/:id/reset-password", requireManager, (req, res) => {
    const userId = parseInt(req.params.id, 10);

    const user = db.prepare(
        "SELECT id, username, full_name, role FROM users WHERE id = ?"
    ).get(userId);

    if (!user) {
        return res.status(404).render("error", {
            title:   "User not found",
            message: `No user with ID ${userId}.`,
        });
    }

    res.render("users-reset-password", {
        title:  `Reset password for ${user.full_name}`,
        active: "users",
        user:   user,
    });
});


// =====================================================
// POST /users/:id/reset-password — apply new password
// =====================================================
router.post("/users/:id/reset-password", requireManager, (req, res) => {
    const userId = parseInt(req.params.id, 10);

    const user = db.prepare(
        "SELECT id, username, full_name FROM users WHERE id = ?"
    ).get(userId);

    if (!user) {
        req.flash("error", "User not found.");
        return res.redirect("/users");
    }

    const { password, confirm_password } = req.body;

    const errors = [];
    if (!password || password.length < 8)  errors.push("Password must be at least 8 characters.");
    if (password !== confirm_password)     errors.push("Passwords do not match.");

    if (errors.length > 0) {
        req.flash("error", errors.join(" "));
        return res.redirect(`/users/${userId}/reset-password`);
    }

    try {
        const passwordHash = bcrypt.hashSync(password, 10);
        db.prepare(
            "UPDATE users SET password_hash = ? WHERE id = ?"
        ).run(passwordHash, userId);

        req.flash(
            "success",
            `Password reset for ${user.full_name}. They must use the new password on their next login.`
        );
        res.redirect("/users");
    } catch (err) {
        console.error("Error resetting password:", err);
        req.flash("error", "Could not reset password: " + err.message);
        res.redirect(`/users/${userId}/reset-password`);
    }
});


module.exports = router;