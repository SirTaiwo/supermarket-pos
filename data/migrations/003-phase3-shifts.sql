-- =====================================================
-- PHASE 3 MIGRATION — Shifts & Till Management
-- =====================================================
-- Adds:
--   - shifts table (one row per cashier shift)
--   - shift_id FK column on sales
--   - shift_id FK column on refunds
--
-- Design:
--   - One open shift per cashier at a time
--   - Sales/refunds attach to the cashier's open shift
--   - Existing sales/refunds (pre-shift-feature) keep NULL
--   - Closed shifts are immutable (audit trail)
--   - Variance = counted_cash - expected_cash
--     (positive = over, negative = short)
-- =====================================================


-- =====================================================
-- SHIFTS
-- =====================================================
-- Tracks an open or closed cashier shift.
--
-- Lifecycle:
--   OPEN  → cashier counted starting float, ready to work
--           closed_at, counted_cash, variance: all NULL
--           status: 'open'
--
--   CLOSED → cashier counted ending cash, variance recorded
--            All closing fields populated
--            status: 'closed'
--
-- Money in cents (matches the rest of the system).
-- =====================================================
CREATE TABLE IF NOT EXISTS shifts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    reference             TEXT    NOT NULL UNIQUE,         -- e.g. SHF-20260609-001
    cashier_id            INTEGER NOT NULL,

    opening_float_cents   INTEGER NOT NULL CHECK (opening_float_cents >= 0),
    opened_at             TEXT    NOT NULL DEFAULT (datetime('now')),

    -- Closing fields (NULL while shift is open)
    closed_at             TEXT,
    expected_cash_cents   INTEGER,
    counted_cash_cents    INTEGER,
    variance_cents        INTEGER,                          -- counted - expected
    variance_reason       TEXT,
    closing_note          TEXT,

    status                TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'closed')),

    FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status     ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened_at  ON shifts(opened_at);
CREATE INDEX IF NOT EXISTS idx_shifts_reference  ON shifts(reference);

-- Partial unique index: only ONE open shift allowed per cashier.
-- (SQLite supports partial indexes since 3.8.0)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_cashier
    ON shifts(cashier_id) WHERE status = 'open';


-- =====================================================
-- ADD shift_id TO sales
-- =====================================================
-- Nullable because pre-shift sales (Phase 1) have no shift.
-- FK to shifts(id). ON DELETE SET NULL so a deleted shift
-- (which shouldn't happen, but defensively) doesn't orphan
-- the sale. RESTRICT on cashier_id still applies.
-- =====================================================
ALTER TABLE sales ADD COLUMN shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales(shift_id);


-- =====================================================
-- ADD shift_id TO refunds
-- =====================================================
ALTER TABLE refunds ADD COLUMN shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_refunds_shift_id ON refunds(shift_id);