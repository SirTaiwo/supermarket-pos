// =====================================================
// Supermarket POS — Authentication routes
// =====================================================
// Handles:
//   GET  /login   — show the login form
//   POST /login   — process credentials via Passport
//   GET  /logout  — destroy session and sign out
// =====================================================

const express = require("express");
const { passport } = require("../middleware/auth");

const router = express.Router();


// -----------------------------------------------------
// GET /login — show the login form
// -----------------------------------------------------
// If already authenticated, send them home instead of
// showing the form again.
// -----------------------------------------------------
router.get("/login", (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.redirect("/");
    }
    res.render("login", { title: "Sign in" });
});


// -----------------------------------------------------
// POST /login — process submitted credentials
// -----------------------------------------------------
// passport.authenticate runs the LocalStrategy we set up
// in middleware/auth.js. If credentials are valid, the
// user is signed in (session cookie set) and redirected
// home. If not, a flash error is set and they go back
// to the login form.
//
// We use a custom callback (third arg) so we can:
//   - return to the original page they were trying to reach
//   - set a friendlier flash error message
// -----------------------------------------------------
router.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
        if (err) return next(err);

        if (!user) {
            req.flash("error", info && info.message ? info.message : "Sign-in failed.");
            return res.redirect("/login");
        }

        req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);

            // If they were trying to reach a protected page, send them there
            const returnTo = req.session.returnTo;
            delete req.session.returnTo;

            return res.redirect(returnTo || "/");
        });
    })(req, res, next);
});


// -----------------------------------------------------
// GET /logout — sign out
// -----------------------------------------------------
// Passport 0.6+ requires a callback to logout for
// cleaner session destruction.
// -----------------------------------------------------
router.get("/logout", (req, res, next) => {
    const username = req.user ? req.user.username : null;

    req.logout((err) => {
        if (err) return next(err);

        // Also destroy the session entirely for safety
        req.session.destroy(() => {
            res.clearCookie("connect.sid");
            return res.redirect("/login");
        });
    });
});


module.exports = router;