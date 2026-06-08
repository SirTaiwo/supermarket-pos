// =====================================================
// Supermarket POS — Migration runner
// =====================================================
// Reads SQL files from data/migrations/ and applies any
// that haven't been recorded in the `migrations` table.
//
// Run with: node data/migrate.js
//
// Idempotent — running it multiple times is safe.
// Already-applied migrations are skipped.
// =====================================================

const path = require("path");
const fs = require("fs");
const db = require("./db");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");


// -----------------------------------------------------
// Ensure the migrations tracking table exists
// -----------------------------------------------------
// (Should already exist from initial setup, but we
// recreate idempotently here so the script is self-
// contained — anyone running it on a fresh database
// would still get the table.)
// -----------------------------------------------------
db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
`);


// -----------------------------------------------------
// Find migration files
// -----------------------------------------------------
if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log("No migrations folder found at", MIGRATIONS_DIR);
    process.exit(0);
}

const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();   // numeric prefixes ensure correct order

if (allFiles.length === 0) {
    console.log("No migration files found.");
    process.exit(0);
}

console.log(`Found ${allFiles.length} migration file(s) in ${MIGRATIONS_DIR}`);


// -----------------------------------------------------
// Look up which migrations have already been applied
// -----------------------------------------------------
const appliedRows = db.prepare("SELECT name FROM migrations").all();
const applied = new Set(appliedRows.map(r => r.name));


// -----------------------------------------------------
// Apply pending migrations
// -----------------------------------------------------
const recordMigration = db.prepare(
    "INSERT INTO migrations (name) VALUES (?)"
);

let appliedCount = 0;
let skippedCount = 0;

for (const filename of allFiles) {
    if (applied.has(filename)) {
        console.log(`  [skip]    ${filename} (already applied)`);
        skippedCount++;
        continue;
    }

    const filepath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filepath, "utf8");

    console.log(`  [apply]   ${filename} ...`);

    try {
        // Run the entire migration inside a transaction
        // so partial failures roll back cleanly.
        db.transaction(() => {
            db.exec(sql);
            recordMigration.run(filename);
        })();

        console.log(`  [ok]      ${filename}`);
        appliedCount++;
    } catch (err) {
        console.error(`  [error]   ${filename}`);
        console.error(`            ${err.message}`);
        console.error("");
        console.error("Migration aborted. The database is unchanged.");
        process.exit(1);
    }
}


// -----------------------------------------------------
// Summary
// -----------------------------------------------------
console.log("");
console.log("===== Migration complete =====");
console.log(`Applied: ${appliedCount}`);
console.log(`Skipped: ${skippedCount}`);
console.log(`Total:   ${allFiles.length}`);