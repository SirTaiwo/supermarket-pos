-- =====================================================
-- PHASE 3 MIGRATION 004 — Online orders (pickup model)
-- =====================================================
-- Adds:
--   - online_orders  (header, customer info, status)
--   - online_order_items (line items, snapshot pattern)
--
-- Design:
--   - Customers anonymously place orders for in-shop pickup
--   - Stock is NOT deducted on order — only reserved
--   - Stock is deducted when cashier marks order 'collected'
--     (which creates a normal sale)
--   - Snapshot pattern preserves prices at time of order
--   - Status: pending → ready → collected (or cancelled)
--
-- Money in cents, VAT in same pattern as sales (inclusive).
-- =====================================================


-- =====================================================
-- ONLINE_ORDERS (header)
-- =====================================================
CREATE TABLE IF NOT EXISTS online_orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    reference         TEXT    NOT NULL UNIQUE,          -- e.g. ORD-20260609-001

    customer_name     TEXT    NOT NULL,
    customer_phone    TEXT    NOT NULL,
    customer_note     TEXT,                              -- optional from checkout

    subtotal_cents    INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    vat_cents         INTEGER NOT NULL CHECK (vat_cents >= 0),
    total_cents       INTEGER NOT NULL CHECK (total_cents >= 0),

    status            TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'ready', 'collected', 'cancelled')),

    -- Set when status moves to 'collected' (becomes a sale)
    sale_id           INTEGER,
    collected_at      TEXT,

    -- Set when status moves to 'cancelled'
    cancelled_at      TEXT,
    cancel_reason     TEXT,

    -- Which staff member converted/cancelled it
    handled_by        INTEGER,

    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (sale_id)    REFERENCES sales(id) ON DELETE SET NULL,
    FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_online_orders_status     ON online_orders(status);
CREATE INDEX IF NOT EXISTS idx_online_orders_created_at ON online_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_online_orders_reference  ON online_orders(reference);
CREATE INDEX IF NOT EXISTS idx_online_orders_sale_id    ON online_orders(sale_id);


-- =====================================================
-- ONLINE_ORDER_ITEMS (line items)
-- =====================================================
-- Snapshot pattern: product_name, product_sku, prices,
-- and VAT rate are frozen at order time. If the product
-- price later changes, the customer still pays what they
-- agreed to online.
-- =====================================================
CREATE TABLE IF NOT EXISTS online_order_items (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id                 INTEGER NOT NULL,
    product_id               INTEGER NOT NULL,

    product_name             TEXT    NOT NULL,           -- snapshot
    product_sku              TEXT    NOT NULL,           -- snapshot

    quantity                 INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents         INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    line_subtotal_cents      INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
    vat_rate_percent         REAL    NOT NULL CHECK (vat_rate_percent >= 0),
    line_vat_cents           INTEGER NOT NULL CHECK (line_vat_cents >= 0),
    line_total_cents         INTEGER NOT NULL CHECK (line_total_cents >= 0),

    FOREIGN KEY (order_id)   REFERENCES online_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)      ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_online_order_items_order_id   ON online_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_online_order_items_product_id ON online_order_items(product_id);