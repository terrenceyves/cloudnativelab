const base = process.env.CATALOG_URL || "http://catalog:3002";

function validProduct(p) {
  return (
    p &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    Number.isSafeInteger(p.unitPrice) &&
    p.unitPrice >= 0 &&
    p.unitPrice <= 10000000
  );
}
async function request(path, requestId) {
  try {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(2000),
      headers: { "X-Request-Id": requestId || "" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Catalogue HTTP " + response.status);
    return await response.json();
  } catch (cause) {
    throw unavailable(cause);
  }
}

function unavailable(cause) {
  return Object.assign(new Error("Catalogue indisponible", { cause }), {
    code: "CATALOG_UNAVAILABLE",
  });
}
export async function getProduct(id, requestId) {
  const product = await request(
    `/products/${encodeURIComponent(id)}`,
    requestId,
  );
  if (product === null) return null;
  if (!validProduct(product) || product.id !== id)
    throw unavailable(new Error("Invalid product contract"));
  return product;
}
export async function listProducts(requestId) {
  const products = await request("/products", requestId);
  if (!Array.isArray(products) || !products.every(validProduct))
    throw unavailable(new Error("Invalid catalogue contract"));
  return products;
}
