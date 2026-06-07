// =====================================================
// Supermarket POS — Database connection helper
// =====================================================
// This file is required by every other module that needs
// to talk to the database. It exports a single shared
// connection so we don't have multiple connections
// fighting over the same SQLite file.
// =====================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Location of the database file on disk
const DB_PATH = path.join(__dirname, "pos.db");

// Open the database (creates the file if it doesn't exist yet)
const db = new Database(DB_PATH);

// -----------------------------------------------------
// PRAGMA settings — important defaults
// -----------------------------------------------------

// Foreign keys are OFF by default in SQLite. We absolutely
// need them on, otherwise our REFERENCES constraints are
// silently ignored.
db.pragma("foreign_keys = ON");

// WAL mode = "Write-Ahead Logging". Allows readers and writers
// to work concurrently without blocking each other. Strongly
// recommended for any SQLite database that takes real traffic.
db.pragma("journal_mode = WAL");

// -----------------------------------------------------
// Load the schema if this is a brand-new database
// -----------------------------------------------------
// We check for one of our tables. If it doesn't exist, this
// is a fresh database and we need to create the structure.

function tableExists(name) {
    const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(name);
    return Boolean(row);
}

if (!tableExists("users")) {
    const schemaPath = path.join(__dirname, "schema.sql");
    if (!fs.existsSync(schemaPath)) {
        throw new Error(
            `Cannot initialize database: schema.sql not found at ${schemaPath}`
        );
    }
    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    db.exec(schemaSql);
    console.log("Database initialized from schema.sql");
}

// -----------------------------------------------------
// Graceful shutdown — close the database cleanly
// -----------------------------------------------------
// SQLite is generally robust, but it's good practice to
// close the database when the process is terminating.

process.on("exit", () => db.close());
process.on("SIGINT", () => {
    db.close();
    process.exit(0);
});

// -----------------------------------------------------
// Export the shared connection
// -----------------------------------------------------
module.exports = db;