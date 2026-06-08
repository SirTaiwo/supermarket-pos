-- =====================================================
-- PHASE 2 MIGRATION — Inventory & Suppliers
-- =====================================================
-- Adds:
--   - suppliers
--   - stock_adjustment_reasons (lookup table)
--   - goods_received_notes (GRN headers)
--   - goods_received_items (GRN line items)
--   - stock_adjustments (individual stock movements)
--
-- Existing Phase 1 tables are not modified.
-- Money is stored in INTEGER cents as in Phase 1.
-- =====================================================


-- =====================================================
-- SUPPLIERS
-- =====================================================
CREATE TABLE IF NOT EXISTS suppliers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    contact_person  TEXT,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    account_number  TEXT,
    payment_terms   TEXT,                                -- e.g. "Net 30", "COD"
    notes           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name      ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);


-- =====================================================
-- STOCK ADJUSTMENT REASONS (lookup table)
-- =====================================================
-- Tracks why an adjustment was made. Each reason is
-- either inherently positive (FOUND), negative (DAMAGE,
-- EXPIRY, THEFT), or neutral (COUNT — could be either).
-- =====================================================
CREATE TABLE IF NOT EXISTS stock_adjustment_reasons (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    direction       TEXT    NOT NULL CHECK (direction IN ('negative', 'positive', 'either')),
    description     TEXT
);

-- Seed the standard reasons
INSERT INTO stock_adjustment_reasons (code, name, direction, description) VALUES
    ('DAMAGE',  'Damaged stock',         'negative', 'Product physically damaged and no longer sellable'),
    ('EXPIRY',  'Expired stock',         'negative', 'Product past its expiry / use-by date'),
    ('THEFT',   'Theft / shrinkage',     'negative', 'Stock missing due to theft or unexplained shrinkage'),
    ('COUNT',   'Physical count variance', 'either', 'Physical stock count differs from system'),
    ('FOUND',   'Stock found',           'positive', 'Previously unrecorded stock discovered'),
    ('OTHER',   'Other adjustment',      'either',   'See note for details');


-- =====================================================
-- GOODS RECEIVED NOTES (GRN headers)
-- =====================================================
-- One row per delivery received from a supplier.
-- Once posted, the GRN cannot be edited — any corrections
-- must go through stock_adjustments. This preserves the
-- audit trail.
-- =====================================================
CREATE TABLE IF NOT EXISTS goods_received_notes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    reference           TEXT    NOT NULL UNIQUE,         -- e.g. GRN-20260607-001
    supplier_id         INTEGER NOT NULL,
    received_by         INTEGER NOT NULL,                -- user_id who recorded the receipt
    supplier_invoice    TEXT,                            -- supplier's own invoice number
    subtotal_cents      INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
    vat_cents           INTEGER NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
    total_cents         INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    status              TEXT    NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided')),
    notes               TEXT,
    received_at         TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
    FOREIGN KEY (received_by) REFERENCES users(id)     ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_grn_received_at ON goods_received_notes(received_at);
CREATE INDEX IF NOT EXISTS idx_grn_supplier_id ON goods_received_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_grn_reference   ON goods_received_notes(reference);


-- =====================================================
-- GOODS RECEIVED ITEMS (GRN line items)
-- =====================================================
-- One row per product per GRN. Captures the cost paid
-- per unit at the moment of receipt. Snapshot pattern
-- preserves product_name and product_sku at receipt
-- time, so historical GRNs stay accurate even if the
-- product is later renamed.
-- =====================================================
CREATE TABLE IF NOT EXISTS goods_received_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    grn_id              INTEGER NOT NULL,
    product_id          INTEGER NOT NULL,
    product_name        TEXT    NOT NULL,                -- snapshot at receipt time
    product_sku         TEXT    NOT NULL,                -- snapshot at receipt time
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_cents     INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
    line_subtotal_cents INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
    vat_rate_percent    REAL    NOT NULL CHECK (vat_rate_percent >= 0),
    line_vat_cents      INTEGER NOT NULL CHECK (line_vat_cents >= 0),
    line_total_cents    INTEGER NOT NULL CHECK (line_total_cents >= 0),

    FOREIGN KEY (grn_id)     REFERENCES goods_received_notes(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)             ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_grn_items_grn_id     ON goods_received_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_items_product_id ON goods_received_items(product_id);


-- =====================================================
-- STOCK ADJUSTMENTS
-- =====================================================
-- Each row represents a SINGLE adjustment of stock,
-- with a reason. The before/after snapshots make the
-- audit trail explicit (anyone reviewing can see what
-- the stock was, what it became, and why).
-- =====================================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    reference       TEXT    NOT NULL UNIQUE,             -- e.g. ADJ-20260607-001
    product_id      INTEGER NOT NULL,
    product_name    TEXT    NOT NULL,                    -- snapshot
    product_sku     TEXT    NOT NULL,                    -- snapshot
    quantity_change INTEGER NOT NULL CHECK (quantity_change != 0),  -- can be + or -, but not 0
    before_qty      INTEGER NOT NULL CHECK (before_qty >= 0),
    after_qty       INTEGER NOT NULL CHECK (after_qty >= 0),
    reason_id       INTEGER NOT NULL,
    note            TEXT,
    adjusted_by     INTEGER NOT NULL,                    -- user_id
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (product_id) REFERENCES products(id)                 ON DELETE RESTRICT,
    FOREIGN KEY (reason_id)  REFERENCES stock_adjustment_reasons(id) ON DELETE RESTRICT,
    FOREIGN KEY (adjusted_by) REFERENCES users(id)                   ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_adj_product_id  ON stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_adj_created_at  ON stock_adjustments(created_at);
CREATE INDEX IF NOT EXISTS idx_adj_reason_id   ON stock_adjustments(reason_id);