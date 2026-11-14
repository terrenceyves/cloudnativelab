const message = document.querySelector('#message');
const result = document.querySelector('#result');
const confirmation = document.querySelector('#confirmation');
let lookupSequence = 0;
async function showConfirmation(orderId) {
  const sequence = ++lookupSequence;
  confirmation.textContent = 'Recherche de la confirmation…';
  try {
    const data = await request(`/orders/${encodeURIComponent(orderId)}/confirmation`);
    if (sequence !== lookupSequence) return;
    confirmation.textContent = data.status === 'confirmed'
      ? `Confirmation traitée : ${data.message}`
      : data.status === 'not_requested' ? data.message : 'Confirmation en attente de traitement. Actualise dans quelques secondes.';
  } catch (error) {
    if (sequence === lookupSequence) confirmation.textContent = error.message;
  }
}
async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Le service est indisponible.');
  return data;
}
function showError(error) {
  message.textContent = error.message;
  result.textContent = '';
  ++lookupSequence;
  confirmation.textContent = 'Aucune confirmation à afficher.';
}
async function init() {
  try {
    const lastId = localStorage.getItem('lastOrderId');
    if (lastId) document.querySelector('#orderId').value = lastId;
  } catch {}
  try {
    const products = await request('/products');
    for (const p of products) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = `${p.name} — ${p.unitPrice.toLocaleString('fr-FR')} FCFA`;
      document.querySelector('#product').append(option);
    }
    document.querySelector('#submit').disabled = false;

  } catch (error) { showError(error); }
}
document.querySelector('#create').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#submit');
  button.disabled = true;
  try {
    const order = await request('/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: document.querySelector('#product').value, quantity: Number(document.querySelector('#quantity').value) })
    });
    document.querySelector('#orderId').value = order.id;
    message.textContent = 'Commande enregistrée dans PostgreSQL. Tu peux maintenant la consulter.';
    result.textContent = JSON.stringify(order, null, 2);
    void showConfirmation(order.id);
    try { localStorage.setItem('lastOrderId', order.id); } catch {}
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
document.querySelector('#lookup').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const order = await request(`/orders/${encodeURIComponent(document.querySelector('#orderId').value.trim())}`);
    message.textContent = 'Commande retrouvée dans PostgreSQL.';
    result.textContent = JSON.stringify(order, null, 2);
    void showConfirmation(order.id);
  } catch (error) { showError(error); }
});
init();
