import express from 'express';
import pg from 'pg';
import { kafka, topic } from './kafka.js';
const pool = new pg.Pool({ connectionTimeoutMillis: 3000, query_timeout: 5000 });
pool.on('error', error => console.error(error.message));
await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
  event_id UUID PRIMARY KEY, order_id UUID NOT NULL UNIQUE,
  correlation_id TEXT, message TEXT NOT NULL, processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS rejected_events (
  topic TEXT NOT NULL, partition INTEGER NOT NULL, event_offset TEXT NOT NULL,
  raw_payload TEXT, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(topic, partition, event_offset)
)`);
const app = express();
app.disable('x-powered-by');
app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'notifications' }); }
  catch { res.status(503).json({ status: 'unavailable' }); }
});
app.get('/notifications/:orderId', async (req, res) => {
  if (!uuid(req.params.orderId)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const result = await pool.query('SELECT * FROM notifications WHERE order_id=$1', [req.params.orderId]);
  if (!result.rows.length) return res.json({ status: 'pending' });
  const row = result.rows[0];
  res.json({ status: 'confirmed', eventId: row.event_id, orderId: row.order_id, message: row.message, processedAt: row.processed_at });
});
app.use((error, req, res, next) => { console.error(error.message); res.status(503).json({ error: 'Notifications indisponibles.' }); });
const server = app.listen(3001, '0.0.0.0');
function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
const consumer = kafka('notifications').consumer({ groupId: 'notifications-v1', allowAutoTopicCreation: false });
consumer.on(consumer.events.CRASH, ({ payload }) => { if (!payload.restart) process.exit(1); });
await consumer.connect();
await consumer.subscribe({ topic, fromBeginning: true });
await consumer.run({
  autoCommit: false,
  eachMessage: async ({ topic, partition, message }) => {
    const raw = message.value?.toString() || '';
    let event;
    try { event = JSON.parse(raw); } catch {}
    if (!event || event.type !== 'OrderCreated' || event.version !== 1 || !uuid(event.eventId) || !uuid(event.data?.orderId)) {
      // Persist poison messages before advancing the offset, so they do not block valid orders.
      await pool.query('INSERT INTO rejected_events(topic,partition,event_offset,raw_payload,reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [topic, partition, message.offset, raw, 'Invalid OrderCreated v1 event']);
      console.error(JSON.stringify({ event: 'notification_rejected', offset: message.offset }));
    } else {
      // One atomic INSERT; a replay cannot produce another confirmation.
      const inserted = await pool.query('INSERT INTO notifications(event_id,order_id,correlation_id,message) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [event.eventId, event.data.orderId, typeof event.correlationId === 'string' ? event.correlationId : null, 'Confirmation simulée : votre commande a été enregistrée.']);
      console.log(JSON.stringify({ event: inserted.rowCount ? 'notification_confirmed' : 'notification_duplicate_ignored', eventId: event.eventId, orderId: event.data.orderId }));
    }
    // Acknowledge only after durable storage. On failure, KafkaJS retries/restarts the consumer.
    await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
  }
});
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 8000).unref();
  server.close();
  await consumer.disconnect();
  await pool.end();
  process.exit(0);
});
