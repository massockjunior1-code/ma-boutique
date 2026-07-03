const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeMoi123";
const DB_PATH = path.join(__dirname, "data", "db.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Utilitaires base de données (fichier JSON) ----------
function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}
function genId(prefix) {
  return prefix + "_" + crypto.randomBytes(5).toString("hex");
}
function genReference() {
  return "CMD-" + Date.now().toString(36).toUpperCase();
}

// ---------- Middleware admin ----------
function requireAdmin(req, res, next) {
  const pass = req.header("x-admin-password");
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe admin invalide." });
  }
  next();
}

// ================= ROUTES PUBLIQUES =================

app.get("/api/products", (req, res) => {
  const db = readDB();
  const products = db.products
    .filter((p) => p.active)
    .map(({ fileUrl, ...pub }) => pub);
  res.json(products);
});

app.get("/api/products/:id", (req, res) => {
  const db = readDB();
  const p = db.products.find((p) => p.id === req.params.id && p.active);
  if (!p) return res.status(404).json({ error: "Produit introuvable." });
  const { fileUrl, ...pub } = p;
  res.json(pub);
});

app.post("/api/orders", (req, res) => {
  const { customerName, phone, email, operator, items } = req.body;

  if (!customerName || !phone || !operator || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Informations manquantes pour la commande." });
  }
  if (!["orange", "mtn"].includes(operator)) {
    return res.status(400).json({ error: "Opérateur Mobile Money invalide." });
  }

  const db = readDB();
  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.products.find((p) => p.id === item.productId && p.active);
    if (!product) return res.status(400).json({ error: `Produit ${item.productId} introuvable.` });
    const qty = Math.max(1, parseInt(item.qty) || 1);
    if (product.stock !== null && product.stock < qty) {
      return res.status(400).json({ error: `Stock insuffisant pour "${product.title}".` });
    }
    total += product.price * qty;
    orderItems.push({ productId: product.id, title: product.title, price: product.price, qty });
  }

  const order = {
    id: genId("ord"),
    reference: genReference(),
    customerName,
    phone,
    email: email || "",
    operator,
    items: orderItems,
    total,
    currency: "XAF",
    status: "en_attente",
    transactionId: "",
    createdAt: new Date().toISOString(),
    confirmedAt: null,
  };

  db.orders.push(order);
  writeDB(db);

  res.json({
    orderId: order.id,
    reference: order.reference,
    total: order.total,
    currency: order.currency,
    message: "Commande créée. En attente de confirmation du paiement Mobile Money.",
  });
});

app.post("/api/orders/:id/declare-payment", (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: "ID de transaction requis." });

  const db = readDB();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });
  if (order.status !== "en_attente") return res.status(400).json({ error: "Cette commande n'est plus en attente." });

  order.transactionId = transactionId;
  writeDB(db);
  res.json({ message: "Merci ! Ton paiement sera vérifié sous peu.", status: order.status });
});

app.get("/api/orders/:id", (req, res) => {
  const db = readDB();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });

  const response = { ...order };
  if (order.status === "paye") {
    response.downloadLinks = order.items.map((it) => {
      const product = db.products.find((p) => p.id === it.productId);
      return { title: it.title, url: product ? product.fileUrl : null };
    });
  }
  res.json(response);
});

// ================= ROUTES ADMIN =================

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Mot de passe incorrect." });
  res.json({ ok: true });
});

app.get("/api/admin/products", requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.products);
});

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const { title, description, category, price, cover, fileUrl, stock } = req.body;
  if (!title || !price || !fileUrl) {
    return res.status(400).json({ error: "Titre, prix et lien du fichier sont obligatoires." });
  }
  const db = readDB();
  const product = {
    id: genId("p"),
    title,
    description: description || "",
    category: category || "Ebook",
    price: Number(price),
    currency: "XAF",
    cover: cover || "",
    fileUrl,
    stock: stock === "" || stock === undefined || stock === null ? null : Number(stock),
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.products.push(product);
  writeDB(db);
  res.json(product);
});

app.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const db = readDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Produit introuvable." });

  const fields = ["title", "description", "category", "price", "cover", "fileUrl", "stock", "active"];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      product[f] = f === "price" || f === "stock" ? (req.body[f] === null || req.body[f] === "" ? null : Number(req.body[f])) : req.body[f];
    }
  }
  writeDB(db);
  res.json(product);
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const db = readDB();
  const idx = db.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Produit introuvable." });
  db.products.splice(idx, 1);
  writeDB(db);
  res.json({ message: "Produit supprimé." });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.orders.slice().reverse());
});

app.post("/api/admin/orders/:id/confirm", requireAdmin, (req, res) => {
  const db = readDB();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });
  if (order.status === "paye") return res.status(400).json({ error: "Commande déjà confirmée." });

  for (const it of order.items) {
    const product = db.products.find((p) => p.id === it.productId);
    if (product && product.stock !== null) {
      product.stock = Math.max(0, product.stock - it.qty);
    }
  }

  order.status = "paye";
  order.confirmedAt = new Date().toISOString();
  writeDB(db);
  res.json(order);
});

app.post("/api/admin/orders/:id/cancel", requireAdmin, (req, res) => {
  const db = readDB();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Commande introuvable." });
  order.status = "annule";
  writeDB(db);
  res.json(order);
});

app.listen(PORT, () => {
  console.log(`Boutique en ligne démarrée sur le port ${PORT}`);
});
