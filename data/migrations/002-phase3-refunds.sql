-- =====================================================
-- PHASE 3 MIGRATION — Refunds & Returns
-- =====================================================
-- Adds:
--   - refunds (header table)
--   - refund_items (line items)
--
-- Refunds are always linked to an original sale.
-- Partial refunds allowed (e.g., return 1 of 3 items).
-- Cumulative protection: cannot over-return a sale item.
-- Once posted, refunds are immutable (audit trail).
-- Money in cents. Snapshot pattern for product details.
-- =====================================================


-- =====================================================
-- REFUNDS (header table)
-- =====================================================
-- One row per refund event. Each refund is linked
-- to exactly one original sale. The total amounts
-- are server-recalculated from refund_items, never
-- trusted from the client.
-- =====================================================
CREATE TABLE IF NOT EXISTS refunds (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    reference          TEXT    NOT NULL UNIQUE,            -- e.g. REF-20260608-001
    original_sale_id   INTEGER NOT NULL,
    cashier_id         INTEGER NOT NULL,                   -- the user processing the refund
    refund_method      TEXT    NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash')),
    subtotal_cents     INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    vat_cents          INTEGER NOT NULL CHECK (vat_cents >= 0),
    total_cents        INTEGER NOT NULL CHECK (total_cents >= 0),
    reason             TEXT,                                -- e.g. "Wrong size", "Damaged"
    note               TEXT,                                -- free text from cashier
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (original_sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
    FOREIGN KEY (cashier_id)       REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at);
CREATE INDEX IF NOT EXISTS idx_refunds_sale_id    ON refunds(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_refunds_cashier_id ON refunds(cashier_id);
CREATE INDEX IF NOT EXISTS idx_refunds_reference  ON refunds(reference);


-- =====================================================
-- REFUND ITEMS (line items)
-- =====================================================
-- One row per product-line being refunded.
-- Each refund_item references the SPECIFIC original
-- sale_item it's refunding (so cumulative limits can
-- be enforced).
--
-- Snapshot pattern: product_name and product_sku
-- are frozen at refund time, so this record stays
-- accurate even if the product is later renamed.
--
-- VAT is calculated using the rate from the original
-- sale_item, preserving the historical VAT
-- treatment (important for SARS reconciliation).
-- =====================================================
CREATE TABLE IF NOT EXISTS refund_items (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    refund_id                INTEGER NOT NULL,
    original_sale_item_id    INTEGER NOT NULL,             -- the specific line being refunded
    product_id               INTEGER NOT NULL,
    product_name             TEXT    NOT NULL,              -- snapshot at refund time
    product_sku              TEXT    NOT NULL,              -- snapshot at refund time
    quantity_refunded        INTEGER NOT NULL CHECK (quantity_refunded > 0),
    unit_price_cents         INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    line_subtotal_cents      INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
    vat_rate_percent         REAL    NOT NULL CHECK (vat_rate_percent >= 0),
    line_vat_cents           INTEGER NOT NULL CHECK (line_vat_cents >= 0),
    line_total_cents         INTEGER NOT NULL CHECK (line_total_cents >= 0),

    FOREIGN KEY (refund_id)             REFERENCES refunds(id)     ON DELETE CASCADE,
    FOREIGN KEY (original_sale_item_id) REFERENCES sale_items(id)  ON DELETE RESTRICT,
    FOREIGN KEY (product_id)            REFERENCES products(id)    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_refund_items_refund_id            ON refund_items(refund_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_product_id           ON refund_items(product_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_original_sale_item_id ON refund_items(original_sale_item_id);