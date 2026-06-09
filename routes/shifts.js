// =====================================================
// Supermarket POS — Shifts & Till Management routes
// =====================================================
// A "shift" is one cashier's till session from
// opening float to closing count.
//
//   GET  /shifts             — list all shifts (manager only)
//   GET  /shifts/current     — my current open shift (or none)
//   GET  /shifts/new         — open-shift form
//   POST /shifts             — open a new shift
//   GET  /shifts/:id/close   — close-shift form (with expected cash)
//   POST /shifts/:id/close   — submit closing counts
//   GET  /shifts/:id         — view a past shift (cashier sees own; manager sees all)
//
// Design:
//   - One open shift per cashier at a time
//     (also enforced by partial unique index in DB)
//   - Closed shifts are immutable
//   - Sales / refunds attach to shift via shift_id (Phase 3 migration 003)
//   - Variance = counted - expected (positive = over, negative = short)
// =====================================================

const express = require("express");
const db = require("../data/db");
const { requireLogin, requireManager } = require("../middleware/auth");
const {
    formatRand,
    formatDate,
    generateShiftReference,
    getCurrentShift,
} = require("../middleware/helpers");

const router = express.Router();


// -----------------------------------------------------
// Helper: calculate expected cash for a shift
// -----------------------------------------------------
// Expected cash = opening_float
//               + sum(cash sales in this shift)
//               - sum(cash refunds in this shift)
//
// (For now, all refunds are cash, and sales may be
// cash or non-cash. We sum only cash sales here.)
// -----------------------------------------------------
function calculateExpectedCash(shiftId, openingFloatCents) {
    const cashSales = db.prepare(`
        SELECT COALESCE(SUM(total_cents), 0) AS n
        FROM sales
        WHERE shift_id = ? AND payment_method = 'cash'
    `).get(shiftId).n;

    const refundsOut = db.prepare(`
        SELECT COALESCE(SUM(total_cents), 0) AS n
        FROM refunds
        WHERE shift_id = ?
    `).get(shiftId).n;

    return openingFloatCents + cashSales - refundsOut;
}


// -----------------------------------------------------
// Helper: full shift activity summary
// -----------------------------------------------------
// Used by close form and detail view.
// Returns counts and totals of sales/refunds in shift.
// -----------------------------------------------------
function getShiftActivity(shiftId) {
    const salesAll = db.prepare(`
        SELECT
            COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS total_cents
        FROM sales
        WHERE shift_id = ?
    `).get(shiftId);

    const salesCash = db.prepare(`
        SELECT
            COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS total_cents
        FROM sales
        WHERE shift_id = ? AND payment_method = 'cash'
    `).get(shiftId);

    const salesOther = db.prepare(`
        SELECT
            COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS total_cents
        FROM sales
        WHERE shift_id = ? AND payment_method != 'cash'
    `).get(shiftId);

    const refunds = db.prepare(`
        SELECT
            COUNT(*) AS count,
            COALESCE(SUM(total_cents), 0) AS total_cents
        FROM refunds
        WHERE shift_id = ?
    `).get(shiftId);

    return {
        sales_all: salesAll,
        sales_cash: salesCash,
        sales_other: salesOther,
        refunds: refunds,
    };
}


// =====================================================
// GET /shifts — list all shifts (manager only)
// =====================================================
router.get("/shifts", requireManager, (req, res) => {
    const shifts = db.prepare(`
        SELECT
            s.id,
            s.reference,
            s.cashier_id,
            s.opening_float_cents,
            s.opened_at,
            s.closed_at,
            s.expected_cash_cents,
            s.counted_cash_cents,
            s.variance_cents,
            s.status,
            u.full_name AS cashier_name,
            (SELECT COUNT(*) FROM sales WHERE shift_id = s.id) AS sales_count,
            (SELECT COALESCE(SUM(total_cents),0) FROM sales WHERE shift_id = s.id) AS sales_total_cents,
            (SELECT COUNT(*) FROM refunds WHERE shift_id = s.id) AS refund_count,
            (SELECT COALESCE(SUM(total_cents),0) FROM refunds WHERE shift_id = s.id) AS refund_total_cents
        FROM shifts s
        LEFT JOIN users u ON s.cashier_id = u.id
        ORDER BY s.opened_at DESC
        LIMIT 100
    `).all();

    res.render("shifts", {
        title:      "Shifts",
        active:     "shifts",
        shifts:     shifts,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


// =====================================================
// GET /shifts/current — my current shift (or none)
// =====================================================
router.get("/shifts/current", requireLogin, (req, res) => {
    const shift = getCurrentShift(db, req.user.id);

    if (!shift) {
        return res.render("shifts-current", {
            title:      "My shift",
            active:     "shifts",
            shift:      null,
            activity:   null,
            expectedCashCents: 0,
            formatRand: formatRand,
            formatDate: formatDate,
        });
    }

    const activity = getShiftActivity(shift.id);
    const expectedCash = calculateExpectedCash(shift.id, shift.opening_float_cents);

    res.render("shifts-current", {
        title:      "My shift",
        active:     "shifts",
        shift:      shift,
        activity:   activity,
        expectedCashCents: expectedCash,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


// =====================================================
// GET /shifts/new — open shift form
// =====================================================
router.get("/shifts/new", requireLogin, (req, res) => {
    // Refuse if user already has an open shift
    const existing = getCurrentShift(db, req.user.id);
    if (existing) {
        req.flash("error",
            `You already have an open shift (${existing.reference}). ` +
            "Close it before opening a new one."
        );
        return res.redirect("/shifts/current");
    }

    res.render("shifts-form", {
        title:  "Open shift",
        active: "shifts",
    });
});


// =====================================================
// POST /shifts — open a new shift
// =====================================================
router.post("/shifts", requireLogin, (req, res) => {
    // Double-check user has no open shift
    const existing = getCurrentShift(db, req.user.id);
    if (existing) {
        req.flash("error",
            `You already have an open shift (${existing.reference}).`
        );
        return res.redirect("/shifts/current");
    }

    // Parse opening float — input is in Rand (decimal), store as cents
    const floatRand = parseFloat(req.body.opening_float);
    if (isNaN(floatRand) || floatRand < 0) {
        req.flash("error", "Opening float must be a number greater than or equal to zero.");
        return res.redirect("/shifts/new");
    }
    const openingFloatCents = Math.round(floatRand * 100);

    try {
        const reference = generateShiftReference(db);
        const result = db.prepare(`
            INSERT INTO shifts (reference, cashier_id, opening_float_cents)
            VALUES (?, ?, ?)
        `).run(reference, req.user.id, openingFloatCents);

        req.flash("success",
            `Shift ${reference} opened with opening float ${formatRand(openingFloatCents)}.`
        );
        res.redirect("/shifts/current");
    } catch (err) {
        console.error("Error opening shift:", err);
        // The partial unique index will trip if there's a race —
        // catch and explain.
        if (String(err.message).toLowerCase().includes("unique")) {
            req.flash("error",
                "You already have an open shift. Refresh and check /shifts/current."
            );
        } else {
            req.flash("error", "Could not open shift: " + err.message);
        }
        res.redirect("/shifts/new");
    }
});


// =====================================================
// GET /shifts/:id/close — close-shift form
// =====================================================
router.get("/shifts/:id/close", requireLogin, (req, res) => {
    const shiftId = parseInt(req.params.id, 10);

    const shift = db.prepare(`
        SELECT s.*, u.full_name AS cashier_name
        FROM shifts s
        LEFT JOIN users u ON s.cashier_id = u.id
        WHERE s.id = ?
    `).get(shiftId);

    if (!shift) {
        return res.status(404).render("error", {
            title:   "Shift not found",
            message: `No shift with ID ${shiftId}.`,
        });
    }

    // Cashiers can only close their own; managers can close any
    if (req.user.role !== "manager" && shift.cashier_id !== req.user.id) {
        return res.status(403).render("error", {
            title:   "Not allowed",
            message: "You can only close your own shift.",
        });
    }

    if (shift.status !== "open") {
        req.flash("error", `Shift ${shift.reference} is already closed.`);
        return res.redirect(`/shifts/${shift.id}`);
    }

    const activity = getShiftActivity(shift.id);
    const expectedCash = calculateExpectedCash(shift.id, shift.opening_float_cents);

    res.render("shifts-close", {
        title:      `Close ${shift.reference}`,
        active:     "shifts",
        shift:      shift,
        activity:   activity,
        expectedCashCents: expectedCash,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


// =====================================================
// POST /shifts/:id/close — submit closing counts
// =====================================================
router.post("/shifts/:id/close", requireLogin, (req, res) => {
    const shiftId = parseInt(req.params.id, 10);

    const shift = db.prepare("SELECT * FROM shifts WHERE id = ?").get(shiftId);
    if (!shift) {
        req.flash("error", "Shift not found.");
        return res.redirect("/shifts/current");
    }

    if (req.user.role !== "manager" && shift.cashier_id !== req.user.id) {
        req.flash("error", "You can only close your own shift.");
        return res.redirect("/shifts/current");
    }

    if (shift.status !== "open") {
        req.flash("error", `Shift ${shift.reference} is already closed.`);
        return res.redirect(`/shifts/${shift.id}`);
    }

    // Parse counted cash (decimal Rand → cents)
    const countedRand = parseFloat(req.body.counted_cash);
    if (isNaN(countedRand) || countedRand < 0) {
        req.flash("error", "Counted cash must be a number greater than or equal to zero.");
        return res.redirect(`/shifts/${shift.id}/close`);
    }
    const countedCashCents = Math.round(countedRand * 100);

    // Server-side expected cash (never trust client)
    const expectedCashCents = calculateExpectedCash(shift.id, shift.opening_float_cents);
    const varianceCents = countedCashCents - expectedCashCents;

    const variance_reason = (req.body.variance_reason || "").trim();
    const closing_note    = (req.body.closing_note || "").trim();

    // If there's any variance, a reason is required
    if (varianceCents !== 0 && !variance_reason) {
        req.flash("error",
            "There is a variance — please record a reason before closing."
        );
        return res.redirect(`/shifts/${shift.id}/close`);
    }

    try {
        db.prepare(`
            UPDATE shifts
            SET status              = 'closed',
                closed_at           = datetime('now'),
                expected_cash_cents = ?,
                counted_cash_cents  = ?,
                variance_cents      = ?,
                variance_reason     = ?,
                closing_note        = ?
            WHERE id = ?
        `).run(
            expectedCashCents,
            countedCashCents,
            varianceCents,
            variance_reason || null,
            closing_note || null,
            shift.id
        );

        let varianceText;
        if (varianceCents === 0) {
            varianceText = "balanced exactly";
        } else if (varianceCents > 0) {
            varianceText = `over by ${formatRand(varianceCents)}`;
        } else {
            varianceText = `short by ${formatRand(Math.abs(varianceCents))}`;
        }

        req.flash("success",
            `Shift ${shift.reference} closed — ${varianceText}.`
        );
        res.redirect(`/shifts/${shift.id}`);
    } catch (err) {
        console.error("Error closing shift:", err);
        req.flash("error", "Could not close shift: " + err.message);
        res.redirect(`/shifts/${shift.id}/close`);
    }
});


// =====================================================
// GET /shifts/:id — view shift detail
// =====================================================
router.get("/shifts/:id", requireLogin, (req, res) => {
    const shiftId = parseInt(req.params.id, 10);

    const shift = db.prepare(`
        SELECT s.*, u.full_name AS cashier_name
        FROM shifts s
        LEFT JOIN users u ON s.cashier_id = u.id
        WHERE s.id = ?
    `).get(shiftId);

    if (!shift) {
        return res.status(404).render("error", {
            title:   "Shift not found",
            message: `No shift with ID ${shiftId}.`,
        });
    }

    // Cashiers can only see their own; managers see all
    if (req.user.role !== "manager" && shift.cashier_id !== req.user.id) {
        return res.status(403).render("error", {
            title:   "Not allowed",
            message: "You can only view your own shifts.",
        });
    }

    const activity = getShiftActivity(shift.id);
    const expectedCashCents = shift.expected_cash_cents !== null
        ? shift.expected_cash_cents
        : calculateExpectedCash(shift.id, shift.opening_float_cents);

    // Fetch the sales and refunds attached to this shift
    const sales = db.prepare(`
        SELECT id, reference, created_at, total_cents, payment_method
        FROM sales
        WHERE shift_id = ?
        ORDER BY created_at ASC
    `).all(shiftId);

    const refunds = db.prepare(`
        SELECT id, reference, created_at, total_cents, reason
        FROM refunds
        WHERE shift_id = ?
        ORDER BY created_at ASC
    `).all(shiftId);

    res.render("shifts-detail", {
        title:      `Shift ${shift.reference}`,
        active:     "shifts",
        shift:      shift,
        activity:   activity,
        expectedCashCents: expectedCashCents,
        sales:      sales,
        refunds:    refunds,
        formatRand: formatRand,
        formatDate: formatDate,
    });
});


module.exports = router;