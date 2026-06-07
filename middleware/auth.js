// =====================================================
// Supermarket POS — Authentication middleware
// =====================================================
// This module configures Passport (with the local
// username/password strategy) and exports two route
// guards: requireLogin and requireManager.
//
// Every protected route uses one of those guards.
// =====================================================

const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");

const db = require("../data/db");


// =====================================================
// PASSPORT STRATEGY
// =====================================================
// passport-local checks a username + password against
// our users table. If the password hash matches via
// bcrypt, the user is considered authenticated.
// =====================================================
passport.use(new LocalStrategy((username, password, done) => {
    try {
        const user = db.prepare(
            "SELECT id, username, full_name, password_hash, role, is_active " +
            "FROM users WHERE username = ?"
        ).get(username);

        // Unknown username
        if (!user) {
            return done(null, false, { message: "Unknown username." });
        }

        // Deactivated account
        if (!user.is_active) {
            return done(null, false, { message: "This account is deactivated." });
        }

        // Password mismatch
        const passwordOk = bcrypt.compareSync(password, user.password_hash);
        if (!passwordOk) {
            return done(null, false, { message: "Incorrect password." });
        }

        // Update last-login timestamp (best effort — don't fail the login if this fails)
        try {
            db.prepare(
                "UPDATE users SET last_login_at = datetime('now') WHERE id = ?"
            ).run(user.id);
        } catch (e) {
            // Non-fatal — log but continue
            console.warn("Could not update last_login_at:", e.message);
        }

        // Return the user object (minus the password hash) to Passport
        return done(null, {
            id:        user.id,
            username:  user.username,
            full_name: user.full_name,
            role:      user.role,
        });
    } catch (err) {
        return done(err);
    }
}));


// =====================================================
// SESSION SERIALIZATION
// =====================================================
// We store only the user ID in the session cookie.
// On every request, deserializeUser fetches the full
// user object fresh from the database.
//
// This means if a manager changes someone's role or
// deactivates their account, the change takes effect
// on the user's NEXT request — they don't keep elevated
// access from a stale session.
// =====================================================
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    try {
        const user = db.prepare(
            "SELECT id, username, full_name, role, is_active FROM users WHERE id = ?"
        ).get(id);

        if (!user || !user.is_active) {
            return done(null, false);
        }

        return done(null, user);
    } catch (err) {
        return done(err);
    }
});


// =====================================================
// ROUTE GUARDS
// =====================================================
// Used on routes that should only be accessible to
// logged-in users (any role) or managers specifically.
// =====================================================

// Blocks anyone not logged in.
function requireLogin(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    // Remember where they were trying to go so we can return there after login
    req.session.returnTo = req.originalUrl;
    res.redirect("/login");
}

// Blocks anyone who isn't a manager (even if logged in as cashier).
function requireManager(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.role === "manager") {
        return next();
    }
    // For logged-in cashiers, send to till. For everyone else, login.
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.status(403).render("error", {
            title: "Access denied",
            message: "This section is restricted to managers.",
            currentUser: req.user,
        });
    }
    return res.redirect("/login");
}


// =====================================================
// EXPORTS
// =====================================================
module.exports = {
    passport,
    requireLogin,
    requireManager,
};