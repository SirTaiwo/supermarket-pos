// =====================================================
// Supermarket POS — Express application entry point
// =====================================================

const path = require("path");
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");

const { passport, requireLogin, requireManager } = require("./middleware/auth");
const helpers = require("./middleware/helpers");

const PORT = process.env.PORT || 3000;
const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    "supermarket-pos-dev-secret-change-me-in-production";

const app = express();

// =====================================================
// VIEW ENGINE
// =====================================================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


// =====================================================
// MIDDLEWARE
// =====================================================

// Serve static assets (CSS, client JS, images) from /public
app.use(express.static(path.join(__dirname, "public")));

// Parse URL-encoded form bodies (login form, etc.)
app.use(express.urlencoded({ extended: true }));

// Parse JSON bodies (the till screen will POST JSON for sales)
app.use(express.json());

// Sessions — must come BEFORE passport
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge:   1000 * 60 * 60 * 8,   // 8 hours (one work shift)
        httpOnly: true,
    },
}));

// Flash messages survive a single redirect
app.use(flash());

// Passport
app.use(passport.initialize());
app.use(passport.session());


// =====================================================
// EXPOSE COMMON VARIABLES TO EVERY VIEW
// =====================================================
// So every EJS template can use `currentUser`, helper
// functions, and flash messages without us passing them
// in every res.render() call.
// =====================================================
app.use((req, res, next) => {
    res.locals.currentUser = req.user || null;
    res.locals.h = helpers;
    res.locals.flashSuccess = req.flash("success");
    res.locals.flashError = req.flash("error");
    next();
});


// =====================================================
// ROUTES
// =====================================================
// Each route file will be added one at a time.
// For now, just a placeholder homepage so the server boots.
// =====================================================

// Home — redirects based on role
app.get("/", (req, res) => {
    if (!req.isAuthenticated()) {
        return res.redirect("/login");
    }
    // Cashiers go to till, managers to reports dashboard
    if (req.user.role === "manager") {
        return res.redirect("/reports/daily");
    }
    return res.redirect("/pos");
});

// Login page
// Authentication routes (GET /login, POST /login, GET /logout)
app.use("/", require("./routes/auth"));
// POS routes (till + product search + sale submission)
app.use("/", require("./routes/pos"));
// Products management (manager only)
app.use("/", require("./routes/products"));
// Reports (manager only)
app.use("/", require("./routes/reports"));


// =====================================================
// 404 HANDLER
// =====================================================
app.use((req, res) => {
    res.status(404).render("error", {
        title: "Page not found",
        message: `Nothing here at ${req.originalUrl}`,
    });
});


// =====================================================
// ERROR HANDLER (last resort)
// =====================================================
// Catches uncaught errors anywhere in the middleware
// chain and renders a friendly error page.
// =====================================================
app.use((err, req, res, next) => {
    console.error("Server error:", err);
    res.status(500).render("error", {
        title: "Something went wrong",
        message: process.env.NODE_ENV === "production"
            ? "An unexpected error occurred. Please try again."
            : err.message,
    });
});


// =====================================================
// START SERVER
// =====================================================
app.listen(PORT, () => {
    console.log("");
    console.log("=================================================");
    console.log("  Supermarket POS — Phase 1 (Core)");
    console.log("=================================================");
    console.log(`  Server running on http://localhost:${PORT}`);
    console.log("");
    console.log("  Demo credentials (after seeding):");
    console.log("    Manager: manager / demo1234");
    console.log("    Cashier: cashier / demo1234");
    console.log("");
    console.log("  Press Ctrl+C to stop.");
    console.log("=================================================");
    console.log("");
});