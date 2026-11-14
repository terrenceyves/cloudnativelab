import express from "express";
import { products } from "./products.js";
export const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () =>
    console.log(
      JSON.stringify({
        event: "catalog_request",
        method: req.method,
        path: req.path,
        requestId: req.get("X-Request-Id"),
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    ),
  );
  next();
});
app.get("/health", (req, res) =>
  res.json({ status: "ok", service: "catalog" }),
);
app.get("/products", (req, res) => res.json(products));
app.get("/products/:id", (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Produit introuvable." });
  res.json(product);
});
app.use((req, res) => res.status(404).json({ error: "Route introuvable." }));
