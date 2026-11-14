import pg from 'pg';
import { kafka, topic, sleep } from './kafka.js';
const pool = new pg.Pool({ connectionTimeoutMillis: 3000, query_timeout: 5000 });
pool.on('error', error => console.error(error.message));
const producer = kafka('orders-outbox').producer({ allowAutoTopicCreation: false });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; setTimeout(() => process.exit(0), 8000).unref(); });
// At-least-once: a crash after send but before COMMIT can publish the same event again.
// The Notifications database deduplicates by eventId and orderId.
while (!stopping) {
  let client;
  try {
    await producer.connect();
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query('SELECT event_id, order_id, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED');
    if (result.rows.length) {
      const event = result.rows[0];
      await producer.send({ topic, acks: -1, messages: [{ key: event.order_id, value: JSON.stringify(event.payload) }] });
      await client.query('UPDATE outbox SET published_at=NOW() WHERE event_id=$1', [event.event_id]);
      console.log(JSON.stringify({ event: 'outbox_published', eventId: event.event_id, orderId: event.order_id }));
    }
    await client.query('COMMIT');
    if (!result.rows.length) await sleep(500);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(JSON.stringify({ event: 'outbox_retry', message: error.message }));
    await producer.disconnect().catch(() => {});
    await sleep(2000);
  } finally { client?.release(); }
}
await producer.disconnect();
await pool.end();
