import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.js';
test('API Catalogue : liste, prix et produit inconnu', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/products`);
    assert.equal(response.status, 200);
    const list = await response.json();
    assert.equal(list.length, 3);
    const product = await fetch(`${base}/products/carnet`);
    assert.deepEqual(await product.json(), { id: 'carnet', name: 'Carnet', unitPrice: 1500 });
    assert.equal((await fetch(`${base}/products/inconnu`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
