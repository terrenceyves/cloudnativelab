import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const post = (body) => fetch(`${base}/orders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('création, calcul du prix côté serveur et lecture depuis PostgreSQL', async () => {
  const response = await post({ productId: 'carnet', quantity: 2 });
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(order.total, 3000);
  assert.equal(order.currency, 'XOF');
  assert.equal(response.headers.get('location'), `/orders/${order.id}`);
  const read = await fetch(`${base}/orders/${order.id}`);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), order);
});
test('quantités invalides et produit inconnu refusés', async () => {
  for (const quantity of [0, -1, 1.5, 101, '2', null]) {
    assert.equal((await post({ productId: 'carnet', quantity })).status, 400);
  }
  assert.equal((await post({ productId: 'inconnu', quantity: 1 })).status, 400);
});
test('prix envoyé par le client refusé', async () => {
  assert.equal((await post({ productId: 'carnet', quantity: 1, unitPrice: 1 })).status, 400);
});
test('JSON malformé refusé sans interrompre le service', async () => {
  const response = await fetch(`${base}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(response.status, 400);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
test('commande absente et identifiant invalide distingués', async () => {
  assert.equal((await fetch(`${base}/orders/${randomUUID()}`)).status, 404);
  assert.equal((await fetch(`${base}/orders/not-an-id`)).status, 400);
});
