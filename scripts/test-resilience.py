#!/usr/bin/env python3
"""Tests de panne du laboratoire local. Restaure les services arrêtés, même en cas d'échec."""
import json
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = '3100'
for line in (ROOT / '.env').read_text().splitlines():
    if line.startswith('APP_PORT='):
        PORT = line.split('=', 1)[1]
BASE = 'http://127.0.0.1:' + PORT

def compose(*args):
    return subprocess.check_output(['docker', 'compose', *args], cwd=ROOT, text=True)

def request(path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def create():
    status, order = request('/orders', {'productId': 'tasse', 'quantity': 1})
    assert status == 201, (status, order)
    return order

def confirm(order):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        status, result = request('/orders/' + order['id'] + '/confirmation')
        if status == 200 and result['status'] == 'confirmed':
            return result
        time.sleep(1)
    raise AssertionError('Confirmation non reçue : ' + order['id'])

try:
    existing = create()
    before = compose('exec', '-T', 'db', 'psql', '-U', 'lab', '-d', 'orders', '-tAc', 'SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM outbox)').strip()
    compose('stop', 'catalog')
    status, error = request('/orders', {'productId': 'carnet', 'quantity': 1})
    assert status == 503 and error['code'] == 'CATALOG_UNAVAILABLE', (status, error)
    status, old = request('/orders/' + existing['id'])
    assert status == 200 and old == existing
    assert request('/products')[0] == 503
    after = compose('exec', '-T', 'db', 'psql', '-U', 'lab', '-d', 'orders', '-tAc', 'SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM outbox)').strip()
    assert before == after, (before, after)
    compose('start', 'catalog')
    for _ in range(30):
        if request('/products')[0] == 200:
            break
        time.sleep(1)
    else:
        raise AssertionError('Catalogue non rétabli')
    assert request('/orders', {'productId': 'carnet', 'quantity': 1})[0] == 201
    print('OK : panne Catalogue bloque les nouvelles commandes sans écriture partielle ; anciennes commandes accessibles ; reprise réussie.', flush=True)

    compose('stop', 'notifications')
    order = create()
    status, result = request('/orders/' + order['id'] + '/confirmation')
    assert status == 503 and result['status'] == 'unavailable'
    compose('start', 'notifications')
    confirm(order)
    print('OK : commande acceptée pendant la panne Notifications, confirmation après reprise.', flush=True)

    compose('stop', 'kafka')
    order = create()
    # Commands accept orders independently of Kafka. The event stays in the outbox.
    sql = "SELECT count(*) FROM outbox WHERE order_id='" + order['id'] + "' AND published_at IS NULL"
    pending = compose('exec', '-T', 'db', 'psql', '-U', 'lab', '-d', 'orders', '-tAc', sql).strip()
    assert pending == '1', pending
    compose('start', 'kafka')
    confirm(order)
    print('OK : événement conservé pendant la panne Kafka, puis publié et confirmé.', flush=True)

    compose('restart', 'notifications-db', 'notifications')
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            result = confirm(order)
            assert result['orderId'] == order['id']
            break
        except (urllib.error.URLError, ConnectionError):
            time.sleep(1)
    else:
        raise AssertionError('Notifications non rétablies')
    print('OK : confirmation conservée après redémarrage de sa base.', flush=True)
finally:
    compose('start', 'catalog', 'kafka', 'notifications-db', 'notifications')
