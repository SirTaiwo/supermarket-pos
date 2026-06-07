// =====================================================
// Supermarket POS — Database seed script
// =====================================================
// Run with: node data/seed.js
//
// Populates the database with:
//   - VAT categories (Standard, Zero-rated, Exempt)
//   - Demo users (manager, cashier)
//   - Realistic South African supermarket products
//
// Safe to run multiple times — clears existing seed data
// before inserting fresh records.
// =====================================================

const bcrypt = require("bcryptjs");
const db = require("./db");

console.log("Seeding Supermarket POS database...");

// =====================================================
// 1. CLEAR EXISTING SEED DATA
// =====================================================
// Done inside a transaction so partial seeds are rolled back
// if anything fails.
// =====================================================
db.transaction(() => {
    db.prepare("DELETE FROM sale_items").run();
    db.prepare("DELETE FROM sales").run();
    db.prepare("DELETE FROM audit_log").run();
    db.prepare("DELETE FROM products").run();
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM vat_categories").run();

    // Reset auto-increment counters so IDs start at 1 again
    db.prepare("DELETE FROM sqlite_sequence").run();
})();

// =====================================================
// 2. VAT CATEGORIES (South African VAT model, 2026)
// =====================================================
const vatCategories = [
    { code: "STD",  name: "Standard rate",  rate: 15.0, description: "Most goods and services" },
    { code: "ZERO", name: "Zero-rated",     rate: 0.0,  description: "Basic foodstuffs basket per SA VAT Act" },
    { code: "EXEMPT", name: "Exempt",        rate: 0.0,  description: "Outside the VAT system" },
];

const insertVat = db.prepare(
    "INSERT INTO vat_categories (code, name, rate_percent, description) VALUES (?, ?, ?, ?)"
);

const vatIds = {};
for (const vat of vatCategories) {
    const result = insertVat.run(vat.code, vat.name, vat.rate, vat.description);
    vatIds[vat.code] = result.lastInsertRowid;
}

console.log(`  Inserted ${vatCategories.length} VAT categories`);

// =====================================================
// 3. DEMO USERS
// =====================================================
// Both passwords are "demo1234". Bcrypt cost factor 10 is the
// modern standard — secure but not punishingly slow.
// =====================================================
const password = "demo1234";
const passwordHash = bcrypt.hashSync(password, 10);

const users = [
    {
        username:  "manager",
        full_name: "Lerato Mthembu",
        role:      "manager",
    },
    {
        username:  "cashier",
        full_name: "Sipho van Wyk",
        role:      "cashier",
    },
];

const insertUser = db.prepare(
    "INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)"
);

for (const u of users) {
    insertUser.run(u.username, u.full_name, passwordHash, u.role);
}

console.log(`  Inserted ${users.length} users (demo password: ${password})`);

// =====================================================
// 4. PRODUCTS
// =====================================================
// All prices in CENTS. R 12.50 = 1250.
// Zero-rated items are SA's "basic foodstuffs basket".
// =====================================================
const products = [
    // ============ ZERO-RATED (basic foodstuffs) ============
    { sku: "ZR-MM-001",  barcode: "6001120100021", name: "Iwisa Super Maize Meal 5kg",        price: 9999,  cost: 7500, vat: "ZERO", stock: 80 },
    { sku: "ZR-MM-002",  barcode: "6001120100038", name: "White Star Maize Meal 2.5kg",       price: 5499,  cost: 4200, vat: "ZERO", stock: 60 },
    { sku: "ZR-BR-001",  barcode: "6001056000017", name: "Albany Brown Bread 700g",           price: 1899,  cost: 1300, vat: "ZERO", stock: 40 },
    { sku: "ZR-RC-001",  barcode: "6001240100147", name: "Tastic Long Grain Rice 2kg",        price: 7499,  cost: 5800, vat: "ZERO", stock: 35 },
    { sku: "ZR-ML-001",  barcode: "6001087340014", name: "Clover Fresh Milk 2L",              price: 4299,  cost: 3300, vat: "ZERO", stock: 50 },
    { sku: "ZR-EG-001",  barcode: "6001275001234", name: "Nulaid Large Eggs (Tray of 18)",    price: 6999,  cost: 5400, vat: "ZERO", stock: 30 },
    { sku: "ZR-OL-001",  barcode: "6009612340021", name: "Sunfoil Cooking Oil 2L",            price: 8999,  cost: 7100, vat: "ZERO", stock: 45 },
    { sku: "ZR-FR-001",  barcode: "0000000000017", name: "Bananas (per kg)",                  price: 2499,  cost: 1700, vat: "ZERO", stock: 100 },
    { sku: "ZR-FR-002",  barcode: "0000000000024", name: "Apples — Granny Smith (per kg)",    price: 3299,  cost: 2300, vat: "ZERO", stock: 80 },
    { sku: "ZR-VG-001",  barcode: "0000000000031", name: "Tomatoes (per kg)",                 price: 2899,  cost: 1900, vat: "ZERO", stock: 60 },
    { sku: "ZR-VG-002",  barcode: "0000000000048", name: "Onions (per kg)",                   price: 1999,  cost: 1300, vat: "ZERO", stock: 70 },
    { sku: "ZR-BN-001",  barcode: "6001240200151", name: "Imbo Sugar Beans 500g",             price: 3499,  cost: 2600, vat: "ZERO", stock: 40 },

    // ============ STANDARD RATE 15% ============
    { sku: "ST-BR-001",  barcode: "6001056000048", name: "Sasko White Bread 700g",            price: 1999,  cost: 1400, vat: "STD",  stock: 45 },
    { sku: "ST-MT-001",  barcode: "6009612000123", name: "Boerewors (per kg)",                price: 13999, cost: 11000, vat: "STD",  stock: 25 },
    { sku: "ST-MT-002",  barcode: "6009612000130", name: "Beef Mince (per kg)",               price: 11999, cost: 9500, vat: "STD",  stock: 30 },
    { sku: "ST-MT-003",  barcode: "6009612000147", name: "Chicken Pieces (per kg)",           price: 8999,  cost: 7100, vat: "STD",  stock: 40 },
    { sku: "ST-CH-001",  barcode: "6001087500021", name: "Clover Cheddar Cheese 250g",        price: 6499,  cost: 4900, vat: "STD",  stock: 35 },
    { sku: "ST-YG-001",  barcode: "6001087600014", name: "Yoghurt Plain 1kg",                 price: 4999,  cost: 3700, vat: "STD",  stock: 30 },
    { sku: "ST-BV-001",  barcode: "6001108000027", name: "Coca-Cola 2L",                      price: 3299,  cost: 2400, vat: "STD",  stock: 80 },
    { sku: "ST-BV-002",  barcode: "6009612400031", name: "Castle Lager 6x340ml",              price: 11999, cost: 9000, vat: "STD",  stock: 50 },
    { sku: "ST-BV-003",  barcode: "6009612400048", name: "Savanna Dry Cider 6x330ml",         price: 14999, cost: 11500, vat: "STD",  stock: 30 },
    { sku: "ST-SN-001",  barcode: "6001240500037", name: "Simba Salt & Vinegar Chips 125g",   price: 2499,  cost: 1800, vat: "STD",  stock: 70 },
    { sku: "ST-SN-002",  barcode: "6001240500044", name: "Niknaks Cheese 135g",               price: 2299,  cost: 1700, vat: "STD",  stock: 75 },
    { sku: "ST-SN-003",  barcode: "6001240500051", name: "Bakers Tennis Biscuits 200g",       price: 2099,  cost: 1500, vat: "STD",  stock: 60 },
    { sku: "ST-HH-001",  barcode: "6001480100012", name: "Sunlight Dishwashing Liquid 750ml", price: 4299,  cost: 3200, vat: "STD",  stock: 40 },
    { sku: "ST-HH-002",  barcode: "6001480100029", name: "OMO Washing Powder 2kg",            price: 11999, cost: 9300, vat: "STD",  stock: 35 },
    { sku: "ST-HH-003",  barcode: "6001480100036", name: "Sunlight Soap (Bar) 175g",          price: 1799,  cost: 1300, vat: "STD",  stock: 50 },
    { sku: "ST-TL-001",  barcode: "6001520200017", name: "Colgate Toothpaste 100ml",          price: 3999,  cost: 2900, vat: "STD",  stock: 45 },
    { sku: "ST-TL-002",  barcode: "6001520200024", name: "Twinsaver Toilet Paper 9-pack",     price: 6999,  cost: 5300, vat: "STD",  stock: 30 },

    // ============ EXEMPT ============
    { sku: "EX-GC-001",  barcode: "0000000099101", name: "Gift Card — R100",                  price: 10000, cost: 10000, vat: "EXEMPT", stock: 999 },
];

const insertProduct = db.prepare(`
    INSERT INTO products (sku, barcode, name, price_cents, cost_cents, vat_category_id, stock_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertManyProducts = db.transaction((items) => {
    for (const p of items) {
        insertProduct.run(p.sku, p.barcode, p.name, p.price, p.cost, vatIds[p.vat], p.stock);
    }
});

insertManyProducts(products);

console.log(`  Inserted ${products.length} products`);

// =====================================================
// SUMMARY
// =====================================================
console.log("");
console.log("===== Seed complete =====");
console.log(`VAT categories: ${vatCategories.length}`);
console.log(`Users:          ${users.length}`);
console.log(`Products:       ${products.length}`);
console.log("");
console.log("Demo credentials:");
console.log("  Manager: manager / demo1234");
console.log("  Cashier: cashier / demo1234");
console.log("");