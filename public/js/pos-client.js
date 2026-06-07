// =====================================================
// Supermarket POS — Till client-side JavaScript
// =====================================================
// Vanilla JS (no framework) for snappy responsiveness.
// Handles search, cart state, totals math, sale submission.
// =====================================================

(function () {
    "use strict";

    // -----------------------------------------------------
    // STATE — single source of truth for the cart
    // -----------------------------------------------------
    // Items in the cart, keyed by product_id. Each entry:
    //   { product, quantity }
    // where `product` is the full product object from the API.
    // -----------------------------------------------------
    const cart = new Map();
    let searchDebounceTimer = null;

    // -----------------------------------------------------
    // DOM references
    // -----------------------------------------------------
    const $clock          = document.getElementById("posClock");
    const $search         = document.getElementById("posSearch");
    const $searchCount    = document.getElementById("searchCount");
    const $productGrid    = document.getElementById("productGrid");
    const $posEmpty       = document.getElementById("posEmpty");
    const $cartItems      = document.getElementById("cartItems");
    const $cartEmpty      = document.getElementById("cartEmpty");
    const $cartTotals     = document.getElementById("cartTotals");
    const $cartClear      = document.getElementById("cartClear");
    const $totalSubtotal  = document.getElementById("totalSubtotal");
    const $totalVat       = document.getElementById("totalVat");
    const $totalGrand     = document.getElementById("totalGrand");
    const $paymentMethod  = document.getElementById("paymentMethod");
    const $completeSale   = document.getElementById("completeSale");
    const $receiptOverlay = document.getElementById("receiptOverlay");
    const $receiptRef     = document.getElementById("receiptRef");
    const $receiptTable   = document.getElementById("receiptTable");
    const $receiptClose   = document.getElementById("receiptClose");
    const $rcpSubtotal    = document.getElementById("rcpSubtotal");
    const $rcpVat         = document.getElementById("rcpVat");
    const $rcpTotal       = document.getElementById("rcpTotal");
    const $rcpPayment     = document.getElementById("rcpPayment");
    const $rcpCashier     = document.getElementById("rcpCashier");
    const $rcpTime        = document.getElementById("rcpTime");


    // =====================================================
    // CLOCK — top-bar live time
    // =====================================================
    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, "0");
        const m = String(now.getMinutes()).padStart(2, "0");
        const s = String(now.getSeconds()).padStart(2, "0");
        $clock.textContent = `${h}:${m}:${s}`;
    }
    updateClock();
    setInterval(updateClock, 1000);


    // =====================================================
    // PRODUCT LOADING & SEARCH
    // =====================================================
    async function loadProducts(query = "") {
        try {
            const response = await fetch(
                `/api/products/search?q=${encodeURIComponent(query)}`,
                { credentials: "same-origin" }
            );
            if (!response.ok) {
                throw new Error("Failed to load products: " + response.status);
            }
            const data = await response.json();
            renderProducts(data.products);
        } catch (err) {
            console.error(err);
            $searchCount.textContent = "Error loading products";
        }
    }

    function renderProducts(products) {
        $productGrid.innerHTML = "";

        if (products.length === 0) {
            $posEmpty.hidden = false;
            $searchCount.textContent = "No matches";
            return;
        }
        $posEmpty.hidden = true;
        $searchCount.textContent = `${products.length} product${products.length === 1 ? "" : "s"}`;

        for (const p of products) {
            const card = document.createElement("button");
            card.className = "product-card";
            card.type = "button";
            card.dataset.productId = p.id;
            card.dataset.outOfStock = p.stock_qty <= 0 ? "true" : "false";

            const stockClass = p.stock_qty <= 5 ? "pc-stock-low" : "";
            const stockText = p.stock_qty <= 0 ? "Out of stock" : `Stock: ${p.stock_qty}`;

            card.innerHTML = `
                <div class="pc-name">${escapeHtml(p.name)}</div>
                <div class="pc-price">${p.price_display}</div>
                <div class="pc-meta">
                    <span class="${stockClass}">${stockText}</span>
                    <span class="pc-vat">${p.vat_code}</span>
                </div>
            `;
            card.addEventListener("click", () => addToCart(p));
            $productGrid.appendChild(card);
        }
    }

    // Search input — debounced so we don't spam the API
    $search.addEventListener("input", () => {
        clearTimeout(searchDebounceTimer);
        const q = $search.value.trim();
        searchDebounceTimer = setTimeout(() => loadProducts(q), 200);
    });


    // =====================================================
    // CART MANAGEMENT
    // =====================================================
    function addToCart(product) {
        if (cart.has(product.id)) {
            const entry = cart.get(product.id);
            // Check stock before incrementing
            if (entry.quantity + 1 > product.stock_qty) {
                alert(`Only ${product.stock_qty} of ${product.name} in stock.`);
                return;
            }
            entry.quantity += 1;
        } else {
            if (product.stock_qty < 1) return;
            cart.set(product.id, { product, quantity: 1 });
        }
        renderCart();
    }

    function changeQuantity(productId, delta) {
        const entry = cart.get(productId);
        if (!entry) return;

        const newQty = entry.quantity + delta;
        if (newQty <= 0) {
            cart.delete(productId);
        } else if (newQty > entry.product.stock_qty) {
            alert(`Only ${entry.product.stock_qty} of ${entry.product.name} in stock.`);
            return;
        } else {
            entry.quantity = newQty;
        }
        renderCart();
    }

    function removeFromCart(productId) {
        cart.delete(productId);
        renderCart();
    }

    function clearCart() {
        cart.clear();
        renderCart();
    }

    $cartClear.addEventListener("click", () => {
        if (confirm("Clear all items from this sale?")) {
            clearCart();
        }
    });


    // =====================================================
    // CART RENDERING + TOTALS
    // =====================================================
    function renderCart() {
        // Clear existing cart-line items (keep the empty-state element)
        const existingLines = $cartItems.querySelectorAll(".cart-line");
        existingLines.forEach(el => el.remove());

        if (cart.size === 0) {
            $cartEmpty.hidden = false;
            $cartTotals.hidden = true;
            $cartClear.hidden = true;
            $completeSale.disabled = true;
            return;
        }

        $cartEmpty.hidden = true;
        $cartTotals.hidden = false;
        $cartClear.hidden = false;
        $completeSale.disabled = false;

        // Render each cart line
        let subtotalCents = 0;
        let vatCents      = 0;
        let totalCents    = 0;

        for (const [productId, entry] of cart) {
            const { product, quantity } = entry;

            // Server-grade VAT-inclusive calculation
            const lineGross = product.price_cents * quantity;
            const lineVat   = product.vat_rate > 0
                ? Math.round((lineGross * product.vat_rate) / (100 + product.vat_rate))
                : 0;
            const lineNet   = lineGross - lineVat;

            subtotalCents += lineNet;
            vatCents      += lineVat;
            totalCents    += lineGross;

            const line = document.createElement("div");
            line.className = "cart-line";
            line.innerHTML = `
                <div>
                    <div class="cart-line-name">${escapeHtml(product.name)}</div>
                    <div class="cart-line-meta">${formatRand(product.price_cents)} &times; ${quantity}</div>
                </div>
                <div class="cart-line-total">${formatRand(lineGross)}</div>
                <div class="cart-line-controls">
                    <button type="button" class="qty-btn" data-action="dec">−</button>
                    <span class="qty-value">${quantity}</span>
                    <button type="button" class="qty-btn" data-action="inc">+</button>
                    <button type="button" class="cart-line-remove" data-action="remove">Remove</button>
                </div>
            `;

            line.querySelector('[data-action="dec"]').addEventListener("click", () => changeQuantity(productId, -1));
            line.querySelector('[data-action="inc"]').addEventListener("click", () => changeQuantity(productId, +1));
            line.querySelector('[data-action="remove"]').addEventListener("click", () => removeFromCart(productId));

            $cartItems.appendChild(line);
        }

        $totalSubtotal.textContent = formatRand(subtotalCents);
        $totalVat.textContent      = formatRand(vatCents);
        $totalGrand.textContent    = formatRand(totalCents);
    }


    // =====================================================
    // COMPLETE SALE
    // =====================================================
    $completeSale.addEventListener("click", async () => {
        if (cart.size === 0) return;

        $completeSale.disabled = true;
        $completeSale.textContent = "Processing...";

        const payload = {
            items: Array.from(cart.values()).map(entry => ({
                product_id: entry.product.id,
                quantity:   entry.quantity,
            })),
            payment_method: $paymentMethod.value,
        };

        try {
            const response = await fetch("/api/sales", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body:    JSON.stringify(payload),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Sale failed.");
            }

            showReceipt(data.sale);
            clearCart();
            loadProducts($search.value.trim());   // refresh stock display
        } catch (err) {
            alert("Sale failed: " + err.message);
        } finally {
            $completeSale.disabled = false;
            $completeSale.textContent = "Complete sale";
        }
    });


    // =====================================================
    // RECEIPT MODAL
    // =====================================================
    function showReceipt(sale) {
        $receiptRef.textContent = sale.reference;
        $rcpSubtotal.textContent = sale.subtotal;
        $rcpVat.textContent      = sale.vat;
        $rcpTotal.textContent    = sale.total;
        $rcpPayment.textContent  = capitalize(sale.payment_method);
        $rcpCashier.textContent  = sale.cashier;
        $rcpTime.textContent     = new Date(sale.created_at).toLocaleString("en-ZA");

        // Build the receipt table
        $receiptTable.innerHTML = "";
        for (const item of sale.items) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>
                    ${escapeHtml(item.name)}<br>
                    <small style="color: var(--muted);">${item.quantity} &times; ${item.unit_price}</small>
                </td>
                <td>${item.line_total}</td>
            `;
            $receiptTable.appendChild(row);
        }

        $receiptOverlay.hidden = false;
    }

    $receiptClose.addEventListener("click", () => {
        $receiptOverlay.hidden = true;
        $search.focus();
    });


    // =====================================================
    // SMALL HELPERS
    // =====================================================
    function formatRand(cents) {
        if (cents === null || cents === undefined) return "R 0.00";
        const rands = (cents / 100).toFixed(2);
        const [whole, decimal] = rands.split(".");
        const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return `R ${withSeparators}.${decimal}`;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function capitalize(str) {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1);
    }


    // =====================================================
    // INITIAL LOAD
    // =====================================================
    loadProducts();
    renderCart();

})();