import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { kafka, topic, sleep } from '../src/kafka.js';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function create() {
  const response = await fetch(`${base}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: 'stylo', quantity: 2 }) });
  assert.equal(response.status, 201);
  return response.json();
}
async function confirmed(id) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/orders/${id}/confirmation`);
    const body = await response.json();
    if (response.ok && body.status === 'confirmed') return body;
    await sleep(500);
  }
  throw new Error(`Confirmation non reçue pour ${id}`);
}
test('outbox durable, livraison Kafka, doublons et message invalide', { timeout: 120000 }, async () => {
  const pool = new pg.Pool();
  const producer = kafka('integration-test').producer({ allowAutoTopicCreation: false });
  try {
    const order = await create();
    const result = await pool.query('SELECT * FROM outbox WHERE order_id=$1', [order.id]);
    assert.equal(result.rows.length, 1);
    const event = result.rows[0].payload;
    assert.equal(event.data.orderId, order.id);
    assert.equal(event.data.total, order.total);
    assert.equal(event.type, 'OrderCreated');
    const first = await confirmed(order.id);
    assert.equal(first.eventId, event.eventId);
    await producer.connect();
    await producer.send({ topic, messages: [
      { key: order.id, value: JSON.stringify(event) },
      { key: order.id, value: JSON.stringify(event) },
      { key: randomUUID(), value: '{invalid-json' }
    ] });
    // A later confirmation proves the consumer passed the duplicates and poison message.
    const next = await create();
    await confirmed(next.id);
    assert.deepEqual(await confirmed(order.id), first);
    const published = await pool.query('SELECT published_at FROM outbox WHERE order_id=$1', [order.id]);
    assert.ok(published.rows[0].published_at);
  } finally { await producer.disconnect(); await pool.end(); }
});
