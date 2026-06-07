-- =====================================================
-- Supermarket POS — Database Schema
-- =====================================================
-- All monetary amounts are stored as INTEGERS in cents
-- (1 Rand = 100 cents). This avoids floating-point errors
-- that would compromise accounting integrity.
-- =====================================================

-- Enable foreign key enforcement (off by default in SQLite)
PRAGMA foreign_keys = ON;


-- =====================================================
-- USERS — Cashiers and managers
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    NOT NULL UNIQUE,
    full_name       TEXT    NOT NULL,
    password_hash   TEXT    NOT NULL,
    role            TEXT    NOT NULL CHECK (role IN ('cashier', 'manager')),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);


-- =====================================================
-- VAT CATEGORIES — Standard, Zero-rated, Exempt
-- =====================================================
-- Stored as a separate table (not hardcoded) so VAT rates
-- can be updated centrally if SARS adjusts them.
-- =====================================================
CREATE TABLE IF NOT EXISTS vat_categories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    rate_percent    REAL    NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
    description     TEXT
);


-- =====================================================
-- PRODUCTS — The catalogue
-- =====================================================
-- price_cents:   selling price in cents (R 12.50 = 1250)
-- cost_cents:    cost price in cents (for margin reports)
-- stock_qty:     current units in stock
-- =====================================================
CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sku             TEXT    NOT NULL UNIQUE,
    barcode         TEXT             UNIQUE,
    name            TEXT    NOT NULL,
    description     TEXT,
    price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents      INTEGER          CHECK (cost_cents IS NULL OR cost_cents >= 0),
    vat_category_id INTEGER NOT NULL,
    stock_qty       INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT,

    FOREIGN KEY (vat_category_id) REFERENCES vat_categories(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_products_sku       ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode   ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name      ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);


-- =====================================================
-- SALES — One row per completed transaction
-- =====================================================
-- subtotal_cents: sum of (price × qty) before VAT
-- vat_cents:     total VAT collected on this sale
-- total_cents:   subtotal + VAT = what the customer paid
-- =====================================================
CREATE TABLE IF NOT EXISTS sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    reference       TEXT    NOT NULL UNIQUE,
    cashier_id      INTEGER NOT NULL,
    subtotal_cents  INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    vat_cents       INTEGER NOT NULL CHECK (vat_cents >= 0),
    total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
    payment_method  TEXT    NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash', 'card', 'mobile')),
    status          TEXT    NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed', 'voided', 'refunded')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_id ON sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_reference  ON sales(reference);


-- =====================================================
-- SALE ITEMS — Line items within each sale
-- =====================================================
-- Captures BOTH a snapshot of the price and VAT at sale-time
-- AND the references back. This is essential for accounting:
-- product prices may change, but historical sales must remain
-- unchanged so audit reports stay accurate.
-- =====================================================
CREATE TABLE IF NOT EXISTS sale_items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id             INTEGER NOT NULL,
    product_id          INTEGER NOT NULL,
    product_name        TEXT    NOT NULL,   -- snapshot at sale time
    product_sku         TEXT    NOT NULL,   -- snapshot at sale time
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents    INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    line_subtotal_cents INTEGER NOT NULL CHECK (line_subtotal_cents >= 0),
    vat_rate_percent    REAL    NOT NULL CHECK (vat_rate_percent >= 0),
    line_vat_cents      INTEGER NOT NULL CHECK (line_vat_cents >= 0),
    line_total_cents    INTEGER NOT NULL CHECK (line_total_cents >= 0),

    FOREIGN KEY (sale_id)    REFERENCES sales(id)    ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);


-- =====================================================
-- AUDIT LOG — Trail of sensitive actions
-- =====================================================
-- Used to record manager-level events: voids, price changes,
-- stock adjustments. Essential for accounting credibility.
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    action          TEXT    NOT NULL,
    target_table    TEXT,
    target_id       INTEGER,
    details         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id    ON audit_log(user_id);