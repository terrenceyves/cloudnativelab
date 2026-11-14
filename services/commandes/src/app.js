import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { pool } from "./database.js";
import { getProduct, listProducts } from "./catalog-client.js";

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const start = Date.now();
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  res.on("finish", () =>
    console.log(
      JSON.stringify({
        event: "http_request",
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    ),
  );
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "orders", database: "connected" });
  } catch {
    res.status(503).json({ status: "unavailable", service: "orders" });
  }
});
app.get("/products", async (req, res) => res.json(await listProducts(req.requestId)));

const mapOrder = (row) => ({
  id: row.id,
  productId: row.product_id,
  productName: row.product_name,
  quantity: row.quantity,
  unitPrice: row.unit_price,
  total: row.total,
  currency: row.currency,
  status: row.status,
  createdAt: row.created_at,
});

app.post("/orders", async (req, res) => {
  const body = req.body;
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return res.status(400).json({ error: "Un objet JSON est requis." });
  }
  if (
    Object.keys(body).some((key) => !["productId", "quantity"].includes(key))
  ) {
    return res
      .status(400)
      .json({
        error:
          "Seuls productId et quantity sont acceptés. Le prix est calculé par le serveur.",
      });
  }
  if (typeof body.productId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(body.productId) ||
      !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 100) {
    return res.status(400).json({ error: 'Produit ou quantité invalide (entier de 1 à 100).' });
  }
  // Synchronous HTTP call BEFORE opening the database transaction.
  const product = await getProduct(body.productId, req.requestId);
  if (!product) return res.status(400).json({ error: 'Produit inconnu.' });
  const client = await pool.connect();
  let order;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO orders (id, product_id, product_name, quantity, unit_price, total)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), product.id, product.name, body.quantity, product.unitPrice, product.unitPrice * body.quantity]
    );
    order = mapOrder(result.rows[0]);
    const event = {
      eventId: randomUUID(), type: "OrderCreated", version: 1,
      occurredAt: order.createdAt, correlationId: req.requestId,
      data: { orderId: order.id, productId: order.productId, quantity: order.quantity, total: order.total, currency: order.currency }
    };
    await client.query("INSERT INTO outbox(event_id, order_id, payload) VALUES ($1, $2, $3)", [event.eventId, order.id, event]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.location(`/orders/${order.id}`).status(201).json(order);
});

app.get("/orders/:id", async (req, res) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      req.params.id,
    )
  ) {
    return res.status(400).json({ error: "Identifiant de commande invalide." });
  }
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [
    req.params.id,
  ]);
  if (!result.rows.length)
    return res.status(404).json({ error: "Commande introuvable." });
  res.json(mapOrder(result.rows[0]));
});

// Small composition endpoint: only the Notifications API reads its own database.
app.get("/orders/:id/confirmation", async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: "Identifiant de commande invalide." });
  }
  const result = await pool.query(`SELECT o.id, x.event_id FROM orders o LEFT JOIN outbox x ON x.order_id=o.id WHERE o.id=$1`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: "Commande introuvable." });
  if (!result.rows[0].event_id) return res.json({ status: "not_requested", message: "Ancienne commande : aucune notification demandée à l’étape 1." });
  try {
    const response = await fetch(`${process.env.NOTIFICATIONS_URL || 'http://notifications:3001'}/notifications/${req.params.id}`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('notifications unavailable');
    res.json(await response.json());
  } catch {
    res.status(503).json({ status: "unavailable", error: "Commande enregistrée. État de confirmation temporairement indisponible." });
  }
});

app.use((req, res) => res.status(404).json({ error: "Route introuvable." }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "JSON invalide." });
  if (error.type === "entity.too.large")
    return res.status(413).json({ error: "Requête trop volumineuse." });
  console.error(
    JSON.stringify({
      event: "request_error",
      requestId: req.requestId,
      message: error.message,
    }),
  );
  if (error.code === 'CATALOG_UNAVAILABLE') {
    return res.status(503).json({ error: 'Catalogue temporairement indisponible. Réessaie plus tard.', code: error.code, requestId: req.requestId });
  }
  res
    .status(503)
    .json({
      error: "Service temporairement indisponible.",
      requestId: req.requestId,
    });
});

export { app };
