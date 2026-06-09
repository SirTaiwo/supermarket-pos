// =====================================================
// Supermarket POS — Shared helper functions
// =====================================================
// Pure functions used across routes and views.
// No database access, no side effects — just utility logic.
// =====================================================


// -----------------------------------------------------
// formatRand(cents) — display money in SA format
// -----------------------------------------------------
// Converts INTEGER cents into "R 12,345.67" string.
// All money in the database is stored as cents (integer)
// to avoid floating-point errors. We only convert to
// decimal here, at the display layer.
//
// Example:
//   formatRand(1250)    → "R 12.50"
//   formatRand(1234567) → "R 12,345.67"
// -----------------------------------------------------
function formatRand(cents) {
    if (cents === null || cents === undefined) return "R 0.00";

    const rands = (cents / 100).toFixed(2);
    // Add thousand separators
    const [whole, decimal] = rands.split(".");
    const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    return `R ${withSeparators}.${decimal}`;
}


// -----------------------------------------------------
// formatDate(isoString) — SA-friendly date format
// -----------------------------------------------------
// Example: "6 Jun 2026, 14:32"
// -----------------------------------------------------
function formatDate(isoString) {
    if (!isoString) return "";

    const d = new Date(isoString);
    return d.toLocaleDateString("en-ZA", {
        day:    "numeric",
        month:  "short",
        year:   "numeric",
    }) + ", " + d.toLocaleTimeString("en-ZA", {
        hour:   "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}


// -----------------------------------------------------
// formatDateOnly(isoString) — date without time
// -----------------------------------------------------
function formatDateOnly(isoString) {
    if (!isoString) return "";

    const d = new Date(isoString);
    return d.toLocaleDateString("en-ZA", {
        day:    "numeric",
        month:  "short",
        year:   "numeric",
    });
}


// -----------------------------------------------------
// calculateLineVat(unitPriceCents, qty, vatRate)
// -----------------------------------------------------
// VAT in South Africa is INCLUSIVE on shelf prices —
// the price displayed already includes VAT.
//
// So if a Castle Lager 6-pack is R 119.99 (at 15% VAT):
//   - The "net" amount (excluding VAT) is R 104.34
//   - The VAT portion is R 15.65
//   - The customer pays R 119.99
//
// Formula:
//   vat_amount = (gross × rate) / (100 + rate)
//
// For a zero-rated or exempt item, VAT is 0 — the whole
// price is the net amount.
//
// Returns an object with all the integer-cent breakdowns:
//   {
//     lineSubtotalCents: 1250,   net of VAT
//     lineVatCents:      188,    VAT portion
//     lineTotalCents:    1438,   gross (what customer pays)
//   }
// -----------------------------------------------------
function calculateLineVat(unitPriceCents, qty, vatRatePercent) {
    // The shelf price IS the gross (VAT-inclusive) amount
    const lineGrossCents = unitPriceCents * qty;

    let lineVatCents = 0;
    if (vatRatePercent > 0) {
        // Standard VAT-inclusive back-calculation
        lineVatCents = Math.round(
            (lineGrossCents * vatRatePercent) / (100 + vatRatePercent)
        );
    }

    const lineSubtotalCents = lineGrossCents - lineVatCents;

    return {
        lineSubtotalCents,   // net of VAT
        lineVatCents,        // VAT portion
        lineTotalCents: lineGrossCents,   // gross — what customer pays
    };
}


// -----------------------------------------------------
// generateSaleReference() — unique-looking sale ID
// -----------------------------------------------------
// Format: "SAL-YYYYMMDD-HHMMSS-XXX"
// Where XXX is a random 3-digit suffix to make collisions
// extremely unlikely even if two sales happen the same second.
// -----------------------------------------------------
function generateSaleReference() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, "0");

    return `SAL-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${random}`;
}

// =====================================================
// generateGrnReference
// =====================================================
// Produces references like GRN-20260608-001
// Sequential within the day. Looks up the highest
// existing reference for today and increments.
// =====================================================
function generateGrnReference(db) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const datePart = `${yyyy}${mm}${dd}`;
    const prefix = `GRN-${datePart}-`;

    // Find the highest existing reference for today
    const row = db.prepare(`
        SELECT reference
        FROM goods_received_notes
        WHERE reference LIKE ?
        ORDER BY reference DESC
        LIMIT 1
    `).get(prefix + "%");

    let nextNumber = 1;
    if (row) {
        // Extract the sequence number from the existing reference
        const parts = row.reference.split("-");
        const lastNum = parseInt(parts[parts.length - 1], 10);
        nextNumber = lastNum + 1;
    }

    const seq = String(nextNumber).padStart(3, "0");
    return `${prefix}${seq}`;
}

// =====================================================
// generateRefundReference
// =====================================================
// Produces references like REF-20260608-001
// Sequential within the day, same pattern as GRN.
// =====================================================
function generateRefundReference(db) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const datePart = `${yyyy}${mm}${dd}`;
    const prefix = `REF-${datePart}-`;

    // Find the highest existing reference for today
    const row = db.prepare(`
        SELECT reference
        FROM refunds
        WHERE reference LIKE ?
        ORDER BY reference DESC
        LIMIT 1
    `).get(prefix + "%");

    let nextNumber = 1;
    if (row) {
        // Extract the sequence number from the existing reference
        const parts = row.reference.split("-");
        const lastNum = parseInt(parts[parts.length - 1], 10);
        nextNumber = lastNum + 1;
    }

    const seq = String(nextNumber).padStart(3, "0");
    return `${prefix}${seq}`;
}


// -----------------------------------------------------
// Export everything
// -----------------------------------------------------
module.exports = {
    formatRand,
    formatDate,
    formatDateOnly,
    calculateLineVat,
    generateSaleReference,
    generateGrnReference,
    generateRefundReference,
};