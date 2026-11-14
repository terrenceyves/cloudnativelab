import pg from "pg";
const pool = new pg.Pool({
  connectionTimeoutMillis: 3000,
  query_timeout: 5000,
});
pool.on("error", (error) =>
  console.error(
    JSON.stringify({ event: "database_pool_error", message: error.message }),
  ),
);

// Small, repeatable schema initialization for the lab. Use migrations as it grows.
await pool.query(`CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  currency TEXT NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);

await pool.query(`CREATE TABLE IF NOT EXISTS outbox (
  event_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
)`);
await pool.query(`CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(created_at) WHERE published_at IS NULL`);


export { pool };
