// Numéro à afficher au client pour envoyer le paiement Mobile Money.
// Remplace ces valeurs par tes vrais numéros Orange Money / MTN MoMo.
const MOBILE_MONEY_NUMBERS = {
  orange: "6XX XXX XXX",
  mtn: "6XX XXX XXX",
};

const state = {
  products: [],
  cart: [], // { productId, title, price, qty, stock }
  currentOrderId: null,
};

const fmt = (n) => new Intl.NumberFormat("fr-FR").format(n) + " XAF";

// ---------- Chargement du catalogue ----------
async function loadCatalog() {
  const catalogEl = document.getElementById("catalog");
  try {
    const res = await fetch("/api/products");
    const products = await res.json();
    state.products = products;

    if (products.length === 0) {
      catalogEl.innerHTML = `<p class="muted">Aucun produit disponible pour le moment.</p>`;
      return;
    }

    catalogEl.innerHTML = products
      .map(
        (p) => `
      <article class="product-card">
        <span class="product-cat">${escapeHtml(p.category)}</span>
        <h3 class="product-title">${escapeHtml(p.title)}</h3>
        <p class="product-desc">${escapeHtml(p.description)}</p>
        ${p.stock !== null ? `<p class="stock-note">${p.stock} disponible(s)</p>` : ""}
        <div class="product-foot">
          <span class="price">${fmt(p.price)}</span>
          <button class="btn-primary btn-small" data-add="${p.id}" ${p.stock === 0 ? "disabled" : ""}>
            ${p.stock === 0 ? "Épuisé" : "Ajouter"}
          </button>
        </div>
      </article>`
      )
      .join("");

    catalogEl.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => addToCart(btn.getAttribute("data-add")));
    });
  } catch (err) {
    catalogEl.innerHTML = `<p class="error-text">Impossible de charger le catalogue.</p>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Panier ----------
function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  if (!product) return;
  const existing = state.cart.find((i) => i.productId === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({ productId, title: product.title, price: product.price, qty: 1 });
  }
  renderCart();
  openCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((i) => i.productId !== productId);
  renderCart();
}

function renderCart() {
  const itemsEl = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total");
  const countEl = document.getElementById("cart-count");

  if (state.cart.length === 0) {
    itemsEl.innerHTML = `<p class="muted">Ton panier est vide.</p>`;
  } else {
    itemsEl.innerHTML = state.cart
      .map(
        (i) => `
      <div class="cart-item">
        <div>
          <div class="cart-item-title">${escapeHtml(i.title)}</div>
          <div class="cart-item-meta">${i.qty} × ${fmt(i.price)}</div>
        </div>
        <button class="cart-item-remove" data-remove="${i.productId}">retirer</button>
      </div>`
      )
      .join("");
    itemsEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(btn.getAttribute("data-remove")));
    });
  }

  const total = state.cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  totalEl.textContent = fmt(total);
  const count = state.cart.reduce((sum, i) => sum + i.qty, 0);
  countEl.textContent = count;
  document.getElementById("btn-checkout").disabled = state.cart.length === 0;
}

function openCart() {
  document.getElementById("cart-drawer").classList.add("open");
  document.getElementById("drawer-overlay").classList.add("show");
}
function closeCart() {
  document.getElementById("cart-drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("show");
}

// ---------- Checkout ----------
function openCheckout() {
  if (state.cart.length === 0) return;
  document.getElementById("checkout-step-form").classList.remove("hidden");
  document.getElementById("checkout-step-ticket").classList.add("hidden");
  document.getElementById("checkout-error").textContent = "";
  document.getElementById("checkout-modal").classList.add("show");
}
function closeCheckout() {
  document.getElementById("checkout-modal").classList.remove("show");
}

async function placeOrder() {
  const customerName = document.getElementById("f-name").value.trim();
  const phone = document.getElementById("f-phone").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const operator = document.querySelector('input[name="operator"]:checked').value;
  const errorEl = document.getElementById("checkout-error");

  if (!customerName || !phone) {
    errorEl.textContent = "Merci de renseigner ton nom et ton numéro.";
    return;
  }

  const items = state.cart.map((i) => ({ productId: i.productId, qty: i.qty }));

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName, phone, email, operator, items }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Erreur lors de la commande.";
      return;
    }

    state.currentOrderId = data.orderId;
    document.getElementById("t-ref").textContent = data.reference;
    document.getElementById("t-total").textContent = fmt(data.total);
    document.getElementById("t-operator").textContent = operator === "orange" ? "Orange Money" : "MTN MoMo";
    document.getElementById("t-paynumber").textContent = MOBILE_MONEY_NUMBERS[operator];
    document.getElementById("declare-error").textContent = "";
    document.getElementById("f-txid").value = "";

    document.getElementById("checkout-step-form").classList.add("hidden");
    document.getElementById("checkout-step-ticket").classList.remove("hidden");

    state.cart = [];
    renderCart();
  } catch (err) {
    errorEl.textContent = "Erreur réseau. Réessaie.";
  }
}

async function declarePayment() {
  const transactionId = document.getElementById("f-txid").value.trim();
  const errorEl = document.getElementById("declare-error");
  if (!transactionId) {
    errorEl.textContent = "Merci de renseigner l'ID de la transaction.";
    return;
  }
  try {
    const res = await fetch(`/api/orders/${state.currentOrderId}/declare-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || "Erreur.";
      return;
    }
    alert("Merci ! Ta commande sera confirmée dès que le paiement sera vérifié. Garde ton identifiant de commande pour suivre son statut : " + state.currentOrderId);
    closeCheckout();
  } catch (err) {
    errorEl.textContent = "Erreur réseau. Réessaie.";
  }
}

// ---------- Suivi de commande ----------
function openOrders() {
  document.getElementById("order-status-result").innerHTML = "";
  document.getElementById("f-order-id").value = "";
  document.getElementById("orders-modal").classList.add("show");
}
function closeOrders() {
  document.getElementById("orders-modal").classList.remove("show");
}

async function trackOrder() {
  const orderId = document.getElementById("f-order-id").value.trim();
  const resultEl = document.getElementById("order-status-result");
  if (!orderId) return;
  resultEl.innerHTML = `<p class="muted">Recherche…</p>`;
  try {
    const res = await fetch(`/api/orders/${orderId}`);
    const data = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<p class="error-text">${data.error || "Commande introuvable."}</p>`;
      return;
    }
    const statusLabel = { en_attente: "En attente de paiement", paye: "Payé", annule: "Annulé" }[data.status];
    let html = `
      <div class="ticket">
        <p class="ticket-line">Référence <span>${data.reference}</span></p>
        <p class="ticket-line">Total <span>${fmt(data.total)}</span></p>
        <p class="ticket-line">Statut <span class="status-pill status-${data.status}">${statusLabel}</span></p>
      </div>`;
    if (data.status === "paye" && data.downloadLinks) {
      html += `<div style="margin-top:14px;">
        <p><strong>Tes téléchargements :</strong></p>
        ${data.downloadLinks
          .map((l) => `<p><a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.title)}</a></p>`)
          .join("")}
      </div>`;
    }
    resultEl.innerHTML = html;
  } catch (err) {
    resultEl.innerHTML = `<p class="error-text">Erreur réseau.</p>`;
  }
}

// ---------- Écouteurs ----------
document.getElementById("btn-cart").addEventListener("click", openCart);
document.getElementById("cart-close").addEventListener("click", closeCart);
document.getElementById("drawer-overlay").addEventListener("click", closeCart);
document.getElementById("btn-checkout").addEventListener("click", () => {
  closeCart();
  openCheckout();
});
document.getElementById("btn-place-order").addEventListener("click", placeOrder);
document.getElementById("btn-declare").addEventListener("click", declarePayment);
document.getElementById("btn-orders").addEventListener("click", openOrders);
document.getElementById("btn-track").addEventListener("click", trackOrder);
document.querySelectorAll("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => {
    closeCheckout();
    closeOrders();
  })
);

loadCatalog();
renderCart();
