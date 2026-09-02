/* ================= FACTURAR (PUNTO DE VENTA) ================= */
/* El carrito admite dos tipos de línea:
   - kind 'product': producto del inventario (descuenta stock)
   - kind 'free'   : artículo escrito a mano (nombre y precio libres) */
const cart = new Map();
let cartUid = 0;
let searchPosTimer;
let posProductCache = [];

function debouncedLoadPosProducts() { clearTimeout(searchPosTimer); searchPosTimer = setTimeout(loadPosProducts, 250); }

function todayStr() { return localDateStr(new Date()); }

async function resetPos() {
  cart.clear(); cartUid = 0;
  document.getElementById('pos-cash-received').value = '';
  document.getElementById('pos-payment').value = 'efectivo';
  const dateEl = document.getElementById('pos-date');
  if (dateEl) dateEl.value = todayStr();
  for (const id of ['pos-client-name', 'pos-client-address', 'pos-client-phone', 'pos-client-email']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  renderCart(); renderPosChange(); updateCashRowVisibility();
}

function clearPosCart() {
  cart.clear();
  renderCart();
}

function updateCashRowVisibility() {
  const method = document.getElementById('pos-payment').value;
  document.getElementById('pos-cash-row').classList.toggle('hidden', method !== 'efectivo');
}
document.getElementById('pos-payment').addEventListener('change', () => { updateCashRowVisibility(); renderPosChange(); });

/* Lista de productos para el selector (modal "Agregar productos") */
function openPosPicker() {
  openModal('🔍 Agregar productos a la venta', `
    <input type="search" id="pos-search" placeholder="Buscar producto por nombre o código..." oninput="debouncedLoadPosProducts()" autofocus>
    <div id="pos-products" class="pos-products pos-picker-grid"></div>
    <p class="config-hint" style="margin-top:.75rem">Haz clic en un producto para agregarlo. Puedes agregarlo varias veces.</p>`);

  const search = document.getElementById('pos-search');
  setTimeout(() => search.focus(), 50);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPosProducts(); } });
  loadPosProducts();
}

/* Agrega desde el caché del selector (evita problemas con comillas en nombres) */
function addFromPicker(index) {
  const p = posProductCache[index];
  if (p) addToCart(p);
}

async function loadPosProducts() {
  try {
    const params = new URLSearchParams();
    const s = document.getElementById('pos-search')?.value.trim() || '';
    if (s) params.set('search', s);

    const products = await api('/products?' + params.toString());
    posProductCache = products;
    const box = document.getElementById('pos-products');
    if (!box) return;

    box.innerHTML = products.length ? products.map((p, i) => {
      const inCart = [...cart.values()].some(e => e.kind === 'product' && e.product.id === p.id);
      return `
      <button type="button" class="pos-product ${inCart ? 'in-cart' : ''}"
        onclick="addFromPicker(${i})"
        ${p.stock === 0 ? 'disabled' : ''}
        title="${p.stock === 0 ? 'Sin stock' : 'Clic para agregar'}">
        <span class="pos-stock">Stock: ${p.stock}</span>
        <strong>${esc(p.name)}</strong>
        <small>${esc(p.code || 'sin código')}</small>
        <span class="pos-price">${money(p.sale_price)}</span>
      </button>`;
    }).join('')
    : '<p class="pos-empty">No se encontraron productos</p>';
  } catch (err) { toast(err.message, 'error'); }
}

async function loadPosCustomers() {
  try {
    const customers = await api('/customers');
    const sel = document.getElementById('pos-customer');
    sel.innerHTML = '<option value="">Venta de mostrador</option>' +
      customers.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' — ' + esc(c.phone) : ''}</option>`).join('');
  } catch { /* silencioso */ }
}

/* Vendedores activos para el selector del punto de venta */
let posSellers = [];
async function loadPosSellers() {
  try {
    posSellers = await api('/users/sellers');
    const sel = document.getElementById('pos-seller');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Sin vendedor —</option>' +
      posSellers.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('');
    if (currentUser && posSellers.some(u => u.id === currentUser.id)) sel.value = currentUser.id;
    renderPosCommission();
  } catch { /* silencioso */ }
}

/* Muestra la comisión estimada de la venta actual según el vendedor elegido */
function renderPosCommission() {
  const el = document.getElementById('pos-commission');
  if (!el) return;
  const sellerId = Number(document.getElementById('pos-seller')?.value);
  if (!sellerId || !cart.size) { el.textContent = ''; return; }
  const s = posSellers.find(u => u.id === sellerId);
  if (!s) { el.textContent = ''; return; }
  const rate = Math.min(100, Math.max(0, Number(s.commission_rate ?? storeSettings.commission_rate) || 0));
  if (!rate) { el.textContent = ''; return; }
  el.textContent = `💡 Comisión de ${s.full_name}: ${money(Math.round(cartTotal() * rate / 100))} (${rate}%)`;
}

function addToCart(p) {
  const entry = [...cart.values()].find(e => e.kind === 'product' && e.product.id === p.id);
  if (entry) {
    if (entry.qty + 1 > p.stock) return toast(`Solo hay ${p.stock} unidades de "${p.name}"`, 'error');
    entry.qty++;
  } else {
    if (p.stock < 1) return toast(`"${p.name}" no tiene stock disponible`, 'error');
    cart.set(++cartUid, { uid: cartUid, kind: 'product', product: p, qty: 1 });
  }
  renderCart();
}

/* Agrega una línea vacía escrita a mano para completar nombre, precio y cantidad */
function addFreeItem() {
  cart.set(++cartUid, { uid: cartUid, kind: 'free', name: '', price: '', qty: 1 });
  renderCart(true);
}

function updateFreeItem(uid, field, value) {
  const e = cart.get(uid);
  if (!e || e.kind !== 'free') return;
  if (field === 'name') e.name = String(value).slice(0, 120);
  if (field === 'price') {
    const n = Number(value);
    e.price = value === '' ? '' : Math.max(0, Math.round(n * 100) / 100);
  }
  if (field === 'qty') {
    const q = parseInt(value, 10);
    e.qty = Number.isInteger(q) && q > 0 ? q : 1;
  }
  renderCart();
}

function changeQty(id, delta) {
  const e = cart.get(id);
  if (!e) return;
  e.qty += delta;
  if (e.qty <= 0) { cart.delete(id); }
  else if (e.kind === 'product' && e.qty > e.product.stock) { e.qty = e.product.stock; toast(`Máximo ${e.product.stock} unidades disponibles`, 'error'); }
  renderCart();
}

function setQty(id, value) {
  const e = cart.get(id);
  if (!e) return;
  const qty = parseInt(value, 10);
  if (!Number.isInteger(qty) || qty <= 0) { cart.delete(id); }
  else e.qty = e.kind === 'product' ? Math.min(qty, e.product.stock) : qty;
  renderCart();
}

function removeFromCart(id) { cart.delete(id); renderCart(); }

function cartTotal() {
  let total = 0;
  for (const e of cart.values()) total += Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty);
  return total;
}

/* % de IVA/impuesto de la venta actual (los precios ya lo incluyen) */
function posTaxRate() {
  const v = Number(document.getElementById('pos-tax-rate')?.value);
  return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 0;
}

function renderPosTotals() {
  const total = cartTotal();
  const rate = posTaxRate();
  const subtotal = rate ? Math.round(total / (1 + rate / 100)) : total;
  document.getElementById('pos-subtotal').textContent = money(subtotal);
  document.getElementById('pos-tax').textContent = money(rate ? total - subtotal : 0);
  document.getElementById('pos-total').textContent = money(total);
  renderPosCommission();
}

function renderCart(focusFirstFree = false) {
  const table = document.getElementById('pos-cart');
  if (!cart.size) {
    table.innerHTML = `
      <thead><tr><th>Código</th><th>Descripción</th><th class="t-center">Cant.</th><th class="t-right">Precio unit.</th><th class="t-right">Precio total</th><th></th></tr></thead>
      <tbody><tr class="empty-row"><td colspan="6">La venta está vacía.<br>Usa <strong>🔍 Agregar productos</strong> para empezar o agrega un artículo escrito a mano.</td></tr></tbody>`;
  } else {
    table.innerHTML = `
      <thead><tr>
        <th style="width:110px">Código</th>
        <th>Descripción</th>
        <th class="t-center" style="width:120px">Cant.</th>
        <th class="t-right" style="width:130px">Precio unit.</th>
        <th class="t-right" style="width:130px">Precio total</th>
        <th style="width:44px"></th>
      </tr></thead>
      <tbody>
        ${[...cart.values()].map(e => {
          const lineTotal = Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty);
          if (e.kind === 'product') {
            return `
              <tr>
                <td><code class="pos-code">${esc(e.product.code || '—')}</code></td>
                <td class="pos-desc">
                  <strong>${esc(e.product.name)}</strong>
                  <small>${e.product.stock} en inventario${e.product.unit ? ' · ' + esc(e.product.unit) : ''}</small>
                </td>
                <td class="t-center">
                  <div class="qty-controls">
                    <button type="button" onclick="changeQty(${e.uid}, -1)">−</button>
                    <input type="number" min="1" max="${e.product.stock}" value="${e.qty}" onchange="setQty(${e.uid}, this.value)">
                    <button type="button" onclick="changeQty(${e.uid}, 1)">＋</button>
                  </div>
                </td>
                <td class="t-right">${money(e.product.sale_price)}</td>
                <td class="t-right pos-line-total">${money(lineTotal)}</td>
                <td><button type="button" class="pos-trash" title="Eliminar fila" onclick="removeFromCart(${e.uid})">🗑</button></td>
              </tr>`;
          }
          return `
            <tr class="free-row">
              <td><code class="pos-code">—</code></td>
              <td class="pos-desc">
                <input type="text" class="ci-free-name" maxlength="120" placeholder="Nombre del artículo..."
                  value="${esc(e.name)}" onchange="updateFreeItem(${e.uid}, 'name', this.value)">
              </td>
              <td class="t-center">
                <div class="qty-controls">
                  <button type="button" onclick="changeQty(${e.uid}, -1)">−</button>
                  <input type="number" min="1" step="1" value="${e.qty}" onchange="setQty(${e.uid}, this.value)">
                  <button type="button" onclick="changeQty(${e.uid}, 1)">＋</button>
                </div>
              </td>
              <td class="t-right"><input type="number" class="pos-price-input" min="0" step="any" placeholder="0"
                value="${e.price}" onchange="updateFreeItem(${e.uid}, 'price', this.value)"></td>
              <td class="t-right pos-line-total">${money(lineTotal)}</td>
              <td><button type="button" class="pos-trash" title="Eliminar fila" onclick="removeFromCart(${e.uid})">🗑</button></td>
            </tr>`;
        }).join('')}
      </tbody>`;
  }
  renderPosTotals();

  if (focusFirstFree) {
    const first = table.querySelector('.free-row .ci-free-name');
    if (first) first.focus();
  }
}

function renderPosChange() {
  const el = document.getElementById('pos-change');
  const received = Number(document.getElementById('pos-cash-received').value);
  const total = cartTotal();

  if (document.getElementById('pos-payment').value !== 'efectivo' || !received || !total) {
    el.textContent = ''; return;
  }
  if (received < total) {
    el.textContent = '⚠️ Falta ' + money(total - received);
    el.style.color = 'var(--red)';
  } else {
    el.textContent = 'Cambio: ' + money(received - total);
    el.style.color = 'var(--green)';
  }
}

async function createInvoice() {
  if (!cart.size) return toast('El carrito está vacío', 'error');

  for (const e of cart.values()) {
    if (e.kind === 'free' && (!e.name.trim() || !(Number(e.price) > 0))) {
      return toast('Completa el nombre y el precio del artículo escrito a mano', 'error');
    }
  }

  // Verificar bloqueo crediticio si es fiado
  const paymentMethod = document.getElementById('pos-payment').value;
  if (paymentMethod === 'fiado' && typeof checkPosBlocked === 'function') {
    const clientName = document.getElementById('pos-client-name').value.trim();
    const customerId = document.getElementById('pos-customer').value;
    let customerName = clientName;
    if (!customerName && customerId) {
      const sel = document.getElementById('pos-customer');
      customerName = sel.selectedOptions[0]?.textContent?.split(' — ')[0]?.trim() || '';
    }
    if (customerName) {
      const blocked = await checkPosBlocked(customerName);
      if (blocked) {
        showBlockedModal(blocked, () => createInvoice());
        return;
      }
    }
  }

  const body = {
    items: [...cart.values()].map(e => e.kind === 'product'
      ? { product_id: e.product.id, quantity: e.qty }
      : { name: e.name.trim(), unit_price: Number(e.price), quantity: e.qty }),
    customer_id: document.getElementById('pos-customer').value || null,
    seller_user_id: document.getElementById('pos-seller').value || null,
    payment_method: paymentMethod,
    client_name: document.getElementById('pos-client-name').value.trim(),
    client_address: document.getElementById('pos-client-address').value.trim(),
    client_phone: document.getElementById('pos-client-phone').value.trim(),
    client_email: document.getElementById('pos-client-email').value.trim()
  };

  try {
    const r = await api('/invoices', { method: 'POST', body });
    toast(r.message);
    if (r.commission_amount > 0) toast(`💡 Comisión registrada: ${money(r.commission_amount)}`);
    const invoiceId = r.id;
    resetPos();
    loadPosProducts();
    printInvoice(invoiceId);
  } catch (err) {
    if (err.message && err.message.includes('bloqueado')) {
      toast(err.message, 'error');
    } else {
      toast(err.message, 'error');
    }
  }
}