import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
test('API Notifications : absence de confirmation et identifiant invalide', async () => {
  const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
  const pending = await fetch(`${base}/notifications/${randomUUID()}`);
  assert.equal(pending.status, 200);
  assert.deepEqual(await pending.json(), { status: 'pending' });
  assert.equal((await fetch(`${base}/notifications/invalide`)).status, 400);
});
