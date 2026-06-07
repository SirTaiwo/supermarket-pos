README.md
# Supermarket POS

A point-of-sale and back-office prototype for a hybrid (in-store + online) supermarket operation, built as a portfolio piece demonstrating the intersection of accounting practice and web development.

> **Status:** Prototype / portfolio piece. Selected modules from a full retail ERP, scoped intentionally narrow.
> Not production retail software — see [Scope & Limitations](#scope--limitations) below.

---

## About the project

This system was built to demonstrate three competencies in one application:

1. **Accounting rigour** — proper VAT handling, atomic transactions, audit-grade record keeping
2. **Software craft** — clean architecture, real authentication, responsive UI, SQL transactions
3. **Domain understanding** — how a supermarket POS actually works, from the cashier's till to the manager's daily report

The author is a chartered accountant (ICAN, Nigeria), educator, and web developer. This project sits at the intersection of all three disciplines.

---

## Features (Phase 1)

### Point of Sale (the till screen)
- Cashier search and select from a product catalog
- Real-time running total with line-by-line VAT calculation
- Multiple VAT categories (standard 15%, zero-rated, exempt)
- Atomic sale completion — sale, sale items, and inventory updates all commit together (or roll back together)
- On-screen receipt display after sale

### Product Catalog
- Product records with name, SKU/barcode, price, VAT category, current stock
- Manager-only edit access
- South African retail items pre-seeded (Boerewors, Castle Lager, Iwisa, Niknaks, fresh produce, etc.)

### Daily Reporting
- Today's sales total
- VAT collected (by category)
- Item count and transaction count
- Top-selling items today

### Authentication
- Role-based access: Cashier and Manager
- bcrypt password hashing
- Session-based login via Passport.js

---

## Tech stack

- **Runtime:** Node.js 20+
- **Server:** Express 5
- **Templates:** EJS
- **Frontend:** Vanilla JavaScript (for fast, snappy till UX without framework overhead)
- **Database:** SQLite via `better-sqlite3` (full SQL transactions, ACID guarantees)
- **Authentication:** Passport.js + bcrypt + express-session

---

## Getting started

### Prerequisites
- Node.js 18 or higher
- npm 8 or higher
- On Windows: Visual Studio Build Tools (needed by `better-sqlite3`)

### Installation

```bash
git clone https://github.com/SirTaiwo/supermarket-pos.git
cd supermarket-pos
npm install
```

### Seed the database

```bash
node data/seed.js
```

This creates `data/pos.db` and populates it with realistic South African supermarket products and demo users.

### Run the server

```bash
npm run dev    # development (auto-restart on file changes)
# or
npm start      # production-style
```

Visit `http://localhost:3000` and sign in with the demo credentials below.

### Demo credentials

| Role     | Username | Password   |
| -------- | -------- | ---------- |
| Manager  | manager  | demo1234   |
| Cashier  | cashier  | demo1234   |

Change these immediately if running anywhere beyond local development.

---

## Project structure

```
supermarket-pos/
├── data/
│   ├── schema.sql       SQLite table definitions
│   ├── seed.js          Demo data (products + users)
│   ├── db.js            Database connection helper
│   └── pos.db           SQLite database (gitignored)
├── middleware/
│   ├── auth.js          Authentication + role guards
│   └── helpers.js       Currency formatting, VAT helpers
├── routes/
│   ├── auth.js          Login, logout
│   ├── pos.js           The till screen
│   ├── products.js      Product CRUD (manager only)
│   └── reports.js       Daily summary (manager only)
├── views/
│   ├── layout.ejs       Shared shell
│   ├── login.ejs
│   ├── pos.ejs          The till screen (the showpiece)
│   ├── products.ejs
│   └── reports/
│       └── daily.ejs
├── public/
│   ├── css/styles.css
│   └── js/pos-client.js  Vanilla JS for the till
├── server.js            Express application entry
├── package.json
└── README.md
```

---

## Scope & Limitations

This is a **scoped prototype**, not production retail software. To be clear about what's included and what isn't:

### What's included (Phase 1)
- Sales transactions with VAT (single till, single shop)
- Product catalog management
- Daily sales reporting
- Two-role authentication

### What's intentionally NOT included
- **Card payment processing** — receipts assume cash payment; no real PCI-DSS integration
- **Barcode scanning hardware** — product selection by search/click in the demo
- **Receipt printing** — receipt displayed on-screen, not sent to a printer
- **Inventory restocking from suppliers** — Phase 2
- **Returns and refunds workflow** — Phase 3
- **Multi-till architecture** — Phase 3+
- **Online store integration** — out of scope for this prototype
- **External audit integration** — out of scope
- **Multi-shop / chain support** — out of scope
- **Payroll, tax filing, regulatory reporting** — out of scope

These are not limitations of effort — they are deliberate scope boundaries. A real supermarket ERP is the work of teams of engineers, accountants, and compliance specialists over many years. This prototype showcases foundational competencies, not feature completeness.

---

## VAT treatment (South Africa)

The system uses the South African VAT model as of 2026:

| Category     | Rate | Examples |
| ------------ | ---- | -------- |
| Standard     | 15%  | Most goods, including alcohol, processed foods |
| Zero-rated   | 0%   | Brown bread, maize meal, fresh produce, rice |
| Exempt       | n/a  | Items outside the VAT system entirely |

VAT is calculated per line item at the point of sale and aggregated for the daily report. Zero-rated items still appear on receipts so they can be reported back to SARS.

---

## Author

**Ogungbola Taiwo Moses**
Chartered Accountant (ICAN, Nigeria) · Educator · Web Developer

[Personal website](https://github.com/SirTaiwo) · [GitHub](https://github.com/SirTaiwo)

---

## License

MIT
