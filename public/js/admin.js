const fmt = (n) => new Intl.NumberFormat("fr-FR").format(n) + " XAF";
let ADMIN_PASSWORD = sessionStorage.getItem("adminPassword") || "";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function apiAdmin(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": ADMIN_PASSWORD,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur serveur.");
  return data;
}

// ---------- Login ----------
document.getElementById("btn-login").addEventListener("click", async () => {
  const password = document.getElementById("f-admin-password").value;
  const errorEl = document.getElementById("login-error");
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error;
      return;
    }
    ADMIN_PASSWORD = password;
    sessionStorage.setItem("adminPassword", password);
    showAdmin();
  } catch (err) {
    errorEl.textContent = "Erreur réseau.";
  }
});

async function showAdmin() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("admin-view").classList.remove("hidden");
  await Promise.all([loadOrders(), loadProducts()]);
}

// Tenter une connexion automatique si mot de passe déjà en session
if (ADMIN_PASSWORD) {
  apiAdmin("/api/admin/products").then(showAdmin).catch(() => {
    sessionStorage.removeItem("adminPassword");
  });
}

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-orders").classList.toggle("hidden", btn.dataset.tab !== "orders");
    document.getElementById("tab-products").classList.toggle("hidden", btn.dataset.tab !== "products");
  });
});

// ---------- Commandes ----------
async function loadOrders() {
  const body = document.getElementById("orders-body");
  try {
    const orders = await apiAdmin("/api/admin/orders");
    updateStats(orders);
    if (orders.length === 0) {
      body.innerHTML = `<tr><td colspan="7" class="muted">Aucune commande pour l'instant.</td></tr>`;
      return;
    }
    body.innerHTML = orders
      .map((o) => {
        const statusLabel = { en_attente: "En attente", paye: "Payé", annule: "Annulé" }[o.status];
        const itemsList = o.items.map((i) => `${i.qty}× ${escapeHtml(i.title)}`).join("<br>");
        return `
        <tr>
          <td>${o.reference}</td>
          <td>${escapeHtml(o.customerName)}<br><span class="muted small">${escapeHtml(o.phone)}</span></td>
          <td>${itemsList}</td>
          <td>${fmt(o.total)}</td>
          <td><span class="badge ${o.status === "paye" ? "badge-on" : o.status === "annule" ? "badge-off" : ""}">${statusLabel}</span></td>
          <td>${o.transactionId ? escapeHtml(o.transactionId) : '<span class="muted small">—</span>'}</td>
          <td class="row-actions">
            ${o.status === "en_attente" ? `<button class="btn-primary btn-small" data-confirm="${o.id}">Confirmer</button>
            <button class="btn-primary btn-small" style="background:#F0E4E0;color:#B3452F;" data-cancel="${o.id}">Annuler</button>` : ""}
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll("[data-confirm]").forEach((btn) =>
      btn.addEventListener("click", () => confirmOrder(btn.getAttribute("data-confirm")))
    );
    body.querySelectorAll("[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => cancelOrder(btn.getAttribute("data-cancel")))
    );
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="error-text">${err.message}</td></tr>`;
  }
}

function updateStats(orders) {
  const paid = orders.filter((o) => o.status === "paye");
  const revenue = paid.reduce((sum, o) => sum + o.total, 0);
  document.getElementById("stats").textContent = `${paid.length} commande(s) payée(s) · ${fmt(revenue)} de revenu`;
}

async function confirmOrder(id) {
  if (!confirm("Confirmer le paiement de cette commande ? Le lien de téléchargement sera débloqué pour le client.")) return;
  try {
    await apiAdmin(`/api/admin/orders/${id}/confirm`, { method: "POST" });
    await loadOrders();
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}
async function cancelOrder(id) {
  if (!confirm("Annuler cette commande ?")) return;
  try {
    await apiAdmin(`/api/admin/orders/${id}/cancel`, { method: "POST" });
    await loadOrders();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Produits ----------
async function loadProducts() {
  const body = document.getElementById("products-body");
  try {
    const products = await apiAdmin("/api/admin/products");
    if (products.length === 0) {
      body.innerHTML = `<tr><td colspan="6" class="muted">Aucun produit.</td></tr>`;
      return;
    }
    body.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${fmt(p.price)}</td>
        <td>${p.stock === null ? "Illimité" : p.stock}</td>
        <td><span class="badge ${p.active ? "badge-on" : "badge-off"}">${p.active ? "Actif" : "Masqué"}</span></td>
        <td class="row-actions">
          <button class="btn-primary btn-small" data-toggle="${p.id}" data-active="${p.active}">${p.active ? "Masquer" : "Activer"}</button>
          <button class="btn-primary btn-small" style="background:#F0E4E0;color:#B3452F;" data-delete="${p.id}">Supprimer</button>
        </td>
      </tr>`
      )
      .join("");

    body.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", () => toggleProduct(btn.getAttribute("data-toggle"), btn.getAttribute("data-active") !== "true"))
    );
    body.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", () => deleteProduct(btn.getAttribute("data-delete")))
    );
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="error-text">${err.message}</td></tr>`;
  }
}

document.getElementById("btn-add-product").addEventListener("click", async (e) => {
  e.preventDefault();
  const title = document.getElementById("p-title").value.trim();
  const description = document.getElementById("p-desc").value.trim();
  const category = document.getElementById("p-category").value.trim() || "Ebook";
  const price = document.getElementById("p-price").value;
  const stock = document.getElementById("p-stock").value;
  const fileUrl = document.getElementById("p-fileurl").value.trim();

  if (!title || !price || !fileUrl) {
    alert("Titre, prix et lien du fichier sont obligatoires.");
    return;
  }

  try {
    await apiAdmin("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({ title, description, category, price, stock, fileUrl }),
    });
    ["p-title", "p-desc", "p-category", "p-price", "p-stock", "p-fileurl"].forEach((id) => (document.getElementById(id).value = ""));
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
});

async function toggleProduct(id, newActive) {
  try {
    await apiAdmin(`/api/admin/products/${id}`, { method: "PUT", body: JSON.stringify({ active: newActive }) });
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}
async function deleteProduct(id) {
  if (!confirm("Supprimer définitivement ce produit ?")) return;
  try {
    await apiAdmin(`/api/admin/products/${id}`, { method: "DELETE" });
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}
