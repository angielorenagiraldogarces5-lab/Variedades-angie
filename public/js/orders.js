/* ================= PEDIDOS (TOMA DE PEDIDOS) ================= */
let orderSearchTimer;
function debouncedLoadOrders() { clearTimeout(orderSearchTimer); orderSearchTimer = setTimeout(loadOrders, 300); }

const ORDER_STATUS_LABELS = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  listo: 'Listo p/ entregar',
  entregado: 'Entregado',
  cancelado: 'Cancelado'
};
const ORDER_EDITABLE = ['pendiente', 'confirmado', 'listo'];

async function loadOrders() {
  try {
    const params = new URLSearchParams();
    const s = document.getElementById('order-search').value.trim();
    if (s) params.set('search', s);
    const st = document.getElementById('order-status-filter').value;
    if (st) params.set('status', st);

    const orders = await api('/orders?' + params.toString());
    const isAdmin = currentUser.role === 'admin';

    document.getElementById('orders-table').innerHTML = `
      <thead><tr>
        <th>N°</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th>Artículos</th><th>Entrega</th><th>Total</th><th>Estado</th><th style="text-align:right">Acciones</th>
      </tr></thead>
      <tbody>
        ${orders.length ? orders.map(o => `
          <tr>
            <td><strong>PD-${String(o.number).padStart(5, '0')}</strong></td>
            <td>${fmtDate(o.created_at)}</td>
            <td>${esc(o.customer_name || o.client_name || '—')}${(o.customer_phone || o.client_phone) ? `<br><small style="color:var(--muted)">${esc(o.customer_phone || o.client_phone)}</small>` : ''}</td>
            <td>${esc(o.seller_name || '—')}</td>
            <td>${o.item_count > 0
              ? `<strong>${esc(o.first_item)}</strong>${o.item_count > 1 ? ` <span class="badge ok more-items">+${o.item_count - 1} más</span>` : ''}`
              : '—'}</td>
            <td>${o.delivery_date ? fmtDue(o.delivery_date) : '—'}${o.invoice_number ? `<br><small style="color:var(--muted)">📄 ${esc(o.invoice_number)}</small>` : ''}</td>
            <td><strong>${money(o.total)}</strong></td>
            <td><span class="badge status-${o.status}">${ORDER_STATUS_LABELS[o.status] || o.status}</span></td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" title="Ver detalle" onclick="viewOrder(${o.id})">👁</button>
              ${ORDER_EDITABLE.includes(o.status) ? `
                <button class="btn btn-outline btn-small" title="Editar" onclick="openOrderModal(${o.id})">✏️</button>
                ${o.status === 'pendiente' ? `<button class="btn btn-primary btn-small" onclick="setOrderStatus(${o.id}, 'confirmado')">✔ Confirmar</button>` : ''}
                ${o.status === 'confirmado' ? `<button class="btn btn-primary btn-small" onclick="setOrderStatus(${o.id}, 'listo')">📦 Listo</button>` : ''}
                ${o.status === 'listo' ? `<button class="btn btn-green btn-small" onclick="openOrderDeliverModal(${o.id})">🚚 Entregar</button>` : ''}
                <button class="btn btn-outline btn-small" title="Imprimir comanda" onclick="printOrderSlip(${o.id})">🖨</button>
                <button class="btn btn-danger btn-small" title="Cancelar pedido" onclick="setOrderStatus(${o.id}, 'cancelado')">🚫</button>`
              : o.status === 'entregado' ? `
                <button class="btn btn-outline btn-small" onclick="printInvoice(${o.invoice_id})">🖨 Factura</button>`
              : ''}
              ${isAdmin && o.status === 'cancelado' ? `<button class="btn btn-danger btn-small" title="Eliminar definitivamente" onclick="deleteOrder(${o.id})">🗑</button>` : ''}
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="9">No hay pedidos. Toma el primero con el botón "＋ Tomar pedido".</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Carrito de artículos del pedido ---------- */
const orderCart = new Map();
let orderCartUid = 0;
const ORDER_PRODUCT_CACHE = new Map();
let orderProductTimer;
let editingOrderId = null;

function debouncedOrderProducts() { clearTimeout(orderProductTimer); orderProductTimer = setTimeout(loadOrderProducts, 250); }

function addOrderProductById(id) {
  const p = ORDER_PRODUCT_CACHE.get(id);
  if (!p) return;
  const entry = [...orderCart.values()].find(e => e.kind === 'product' && e.product.id === id);
  if (entry) entry.qty++;
  else orderCart.set(++orderCartUid, { uid: orderCartUid, kind: 'product', product: p, qty: 1 });
  renderOrderItems();
}

async function loadOrderProducts() {
  try {
    const s = document.getElementById('ord-search')?.value.trim() || '';
    const products = await api('/products' + (s ? '?search=' + encodeURIComponent(s) : ''));
    const box = document.getElementById('ord-results');
    if (!box) return;

    box.innerHTML = products.length ? products.map(p => {
      ORDER_PRODUCT_CACHE.set(p.id, p);
      const inCart = [...orderCart.values()].some(e => e.kind === 'product' && e.product.id === p.id);
      return `
        <button type="button" class="pos-product ${inCart ? 'in-cart' : ''}" onclick="addOrderProductById(${p.id})"
          title="${p.stock === 0 ? 'Sin stock hoy: se puede encargar igual, se valida al entregar' : 'Clic para agregar al pedido'}">
          <span class="pos-stock">${p.stock === 0 ? '⚠️ Sin stock' : 'Stock: ' + p.stock}</span>
          <strong>${esc(p.name)}</strong>
          <small>${esc(p.code || 'sin código')}</small>
          <span class="pos-price">${money(p.sale_price)}</span>
        </button>`;
    }).join('')
    : '<p class="pos-empty">No se encontraron productos</p>';
  } catch (err) {
    const box2 = document.getElementById('ord-results');
    if (box2) box2.innerHTML = '<p class="pos-empty">⚠️ Error al buscar productos: ' + esc(err.message) + '</p>';
  }
}

function addOrderFreeItem() {
  orderCart.set(++orderCartUid, { uid: orderCartUid, kind: 'free', name: '', price: '', qty: 1 });
  renderOrderItems(true);
}

function updateOrderItem(uid, field, value) {
  const e = orderCart.get(uid);
  if (!e || e.kind !== 'free') return;
  if (field === 'name') e.name = String(value).slice(0, 120);
  if (field === 'price') {
    const n = Number(value);
    e.price = value === '' ? '' : Math.max(0, Math.round(n * 100) / 100);
  }
  renderOrderItems();
}

function changeOrderQty(uid, delta) {
  const e = orderCart.get(uid);
  if (!e) return;
  e.qty += delta;
  if (e.qty <= 0) orderCart.delete(uid);
  renderOrderItems();
}

function setOrderQty(uid, value) {
  const e = orderCart.get(uid);
  if (!e) return;
  const q = parseInt(value, 10);
  if (!Number.isInteger(q) || q <= 0) orderCart.delete(uid);
  else e.qty = q;
  renderOrderItems();
}

function removeOrderItem(uid) { orderCart.delete(uid); renderOrderItems(); }

function orderCartTotal() {
  let t = 0;
  for (const e of orderCart.values()) t += Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty);
  return t;
}

function renderOrderItems(focusFirstFree = false) {
  const box = document.getElementById('ord-staging');
  if (!box) return;

  box.innerHTML = orderCart.size ? `
    <table class="mini-table">
      <thead><tr><th>Cant.</th><th>Artículo</th><th class="t-right">Vr. unitario</th><th class="t-right">Total</th><th></th></tr></thead>
      <tbody>
        ${[...orderCart.values()].map(e => {
          const lineTotal = Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty);
          return `
          <tr class="${e.kind === 'free' ? 'free-row' : ''}">
            <td>
              <div class="qty-controls">
                <button type="button" onclick="changeOrderQty(${e.uid}, -1)">−</button>
                <input type="number" min="1" step="1" value="${e.qty}" onchange="setOrderQty(${e.uid}, this.value)">
                <button type="button" onclick="changeOrderQty(${e.uid}, 1)">＋</button>
              </div>
            </td>
            <td>${e.kind === 'product'
              ? `<strong>${esc(e.product.name)}</strong>${e.product.stock === 0 ? ' <span class="badge out">sin stock</span>' : ''}`
              : `<input type="text" class="ci-free-name" maxlength="120" placeholder="Nombre del artículo..." value="${esc(e.name)}" onchange="updateOrderItem(${e.uid}, 'name', this.value)">`}</td>
            <td class="t-right">${e.kind === 'product'
              ? money(e.product.sale_price)
              : `<input type="number" class="pos-price-input" min="0" step="any" placeholder="0" value="${e.price}" onchange="updateOrderItem(${e.uid}, 'price', this.value)">`}</td>
            <td class="t-right pos-line-total">${money(lineTotal)}</td>
            <td><button type="button" class="pos-trash" title="Quitar" onclick="removeOrderItem(${e.uid})">🗑</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div class="pos-total-row"><span>Total estimado del pedido</span><strong>${money(orderCartTotal())}</strong></div>`
    : '<p class="pos-empty">Busca productos arriba o escribe un artículo a mano para armar el pedido.</p>';

  if (focusFirstFree) {
    const first = box.querySelector('.free-row .ci-free-name');
    if (first) first.focus();
  }
}

/* ---------- Tomar / editar un pedido ---------- */
async function openOrderModal(id = null) {
  editingOrderId = id;
  orderCart.clear(); orderCartUid = 0;

  let customers = [], sellers = [], order = null;
  try {
    [customers, sellers] = await Promise.all([api('/customers'), api('/users/sellers')]);
    if (id) order = await api('/orders/' + id);
  } catch (err) { toast(err.message, 'error'); return; }

  if (order) {
    for (const it of order.items) {
      if (it.product_id) {
        orderCart.set(++orderCartUid, {
          uid: orderCartUid, kind: 'product', qty: it.quantity,
          product: { id: it.product_id, code: it.code || '', name: it.name, sale_price: it.unit_price, stock: null }
        });
      } else {
        orderCart.set(++orderCartUid, { uid: orderCartUid, kind: 'free', name: it.name, price: it.unit_price, qty: it.quantity });
      }
    }
  }

  openModal(order ? '✏️ Editar pedido PD-' + String(order.number).padStart(5, '0') : '📋 Tomar nuevo pedido', `
    <form id="order-form">
      <div class="form-grid">
        <div><label>Cliente registrado</label>
          <select name="customer_id">
            <option value="">— Sin registro —</option>
            ${customers.map(c => `<option value="${c.id}" ${order && order.customer_id == c.id ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' — ' + esc(c.phone) : ''}</option>`).join('')}
          </select></div>
        <div><label>Vendedor que atiende</label>
          <select name="seller_user_id">
            <option value="">— Sin vendedor —</option>
            ${sellers.map(u => `<option value="${u.id}" ${(order ? order.seller_user_id : currentUser.id) == u.id ? 'selected' : ''}>${esc(u.full_name)}</option>`).join('')}
          </select></div>
        <div><label>Nombre del cliente</label><input name="client_name" maxlength="80" value="${esc(order?.client_name || '')}" placeholder="Si no está registrado"></div>
        <div><label>Teléfono</label><input name="client_phone" maxlength="40" value="${esc(order?.client_phone || '')}" placeholder="Ej: 11 2345-6789"></div>
        <div class="full"><label>Dirección de entrega</label><input name="client_address" maxlength="120" value="${esc(order?.client_address || '')}" placeholder="Calle y altura, ciudad..."></div>
        <div><label>Fecha de entrega</label><input name="delivery_date" type="date" value="${order?.delivery_date || ''}"></div>
        <div class="full"><label>Notas</label><input name="notes" maxlength="300" value="${esc(order?.notes || '')}" placeholder="Detalles del encargo..."></div>
      </div>

      <p class="config-hint">El pedido NO descuenta stock. Al entregarlo se genera la factura y recién ahí sale del inventario.</p>

      <div class="pos-grid" style="grid-template-columns:1fr;gap:.75rem">
        <input type="search" id="ord-search" placeholder="Buscar producto por nombre o código..." oninput="debouncedOrderProducts()">
        <button type="button" class="btn btn-outline btn-block" onclick="addOrderFreeItem()">✍️ Agregar artículo escrito a mano</button>
        <div id="ord-results" class="pos-products" style="max-height:170px"></div>
        <div id="ord-staging"></div>
        <p class="form-error"></p>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">${order ? '💾 Guardar cambios' : '✅ Tomar pedido'}</button>
      </div>
    </form>`, { wide: true });

  renderOrderItems();
  loadOrderProducts();

  document.getElementById('order-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const errEl = f.querySelector('.form-error');
    errEl.textContent = '';

    if (!orderCart.size) { errEl.textContent = 'Agrega al menos un artículo al pedido'; return; }
    for (const e of orderCart.values()) {
      if (e.kind === 'free' && !String(e.name).trim()) {
        errEl.textContent = 'Escribe el nombre de cada artículo agregado a mano';
        return;
      }
    }

    const body = {
      items: [...orderCart.values()].map(e => e.kind === 'product'
        ? { product_id: e.product.id, quantity: e.qty }
        : { name: String(e.name).trim(), unit_price: Number(e.price), quantity: e.qty }),
      customer_id: f.customer_id.value || null,
      seller_user_id: f.seller_user_id.value || null,
      client_name: f.client_name.value.trim(),
      client_phone: f.client_phone.value.trim(),
      client_address: f.client_address.value.trim(),
      delivery_date: f.delivery_date.value || null,
      notes: f.notes.value.trim()
    };

    try {
      const r = editingOrderId
        ? await api('/orders/' + editingOrderId, { method: 'PUT', body })
        : await api('/orders', { method: 'POST', body });
      closeModal(); toast(r.message); loadOrders();
    } catch (err) { errEl.textContent = err.message; }
  });
}

/* ---------- Ver detalle del pedido ---------- */
async function viewOrder(id) {
  try {
    const o = await api('/orders/' + id);
    const editable = ORDER_EDITABLE.includes(o.status);

    openModal('Pedido PD-' + String(o.number).padStart(5, '0'), `
      <div class="card-info">
        <div><strong>Estado</strong><span class="badge status-${o.status}">${ORDER_STATUS_LABELS[o.status] || o.status}</span></div>
        <div><strong>Tomado</strong>${fmtDate(o.created_at)}<br><small>por ${esc(o.user_name)}</small></div>
        <div><strong>Vendedor(a)</strong>${esc(o.seller_name || '—')}</div>
        <div><strong>Entrega</strong>${o.delivery_date ? fmtDue(o.delivery_date) : '—'}</div>
      </div>

      <div class="collect-info">
        <div>
          <strong>${esc(o.customer_name || o.client_name || 'Sin cliente indicado')}</strong><br>
          <small>${esc([o.client_phone, o.client_address].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
        </div>
        <div class="collect-debt">
          <small>Total estimado</small>
          <strong>${money(o.total)}</strong>
        </div>
      </div>

      <table class="mini-table">
        <thead><tr><th>Cant.</th><th>Artículo</th><th class="t-right">Vr. unitario</th><th class="t-right">Total</th></tr></thead>
        <tbody>
          ${o.items.map(it => `
            <tr>
              <td>${it.quantity}</td>
              <td>${esc(it.name)}${it.code ? ` <code>${esc(it.code)}</code>` : ''}</td>
              <td class="t-right">${money(it.unit_price)}</td>
              <td class="t-right">${money(it.line_total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      ${o.notes ? `<p class="config-hint">📌 ${esc(o.notes)}</p>` : ''}
      ${o.invoice_number ? `<p class="config-hint">📄 Entregado con la factura <strong>${esc(o.invoice_number)}</strong>.</p>` : ''}
      ${!editable && o.status !== 'entregado' && !o.invoice_number ? '<p class="config-hint">🚫 Pedido cancelado.</p>' : ''}

      <div class="form-actions">
        ${editable ? `<button type="button" class="btn btn-primary" onclick="closeModal(); openOrderModal(${o.id})">✏️ Editar</button>` : ''}
        ${o.status !== 'entregado' ? `<button type="button" class="btn btn-outline" onclick="printOrderSlip(${o.id})">🖨 Imprimir comanda</button>` : ''}
        ${o.invoice_id ? `<button type="button" class="btn btn-outline" onclick="printInvoice(${o.invoice_id})">🧾 Ver factura</button>` : ''}
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cerrar</button>
      </div>
    `, { wide: true });
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Cambiar estado: confirmar / listo / cancelar ---------- */
const ORDER_STATUS_CONFIRM = {
  confirmado: '¿Confirmar este pedido?',
  listo: '¿Marcar como LISTO para entregar?',
  cancelado: '¿Cancelar este pedido? Quedará en la lista solo si filtras por "Cancelados".'
};

async function setOrderStatus(id, status) {
  if (!confirm(ORDER_STATUS_CONFIRM[status] || '¿Cambiar el estado del pedido?')) return;
  try {
    const r = await api(`/orders/${id}/status`, { method: 'POST', body: { status } });
    toast(r.message); loadOrders();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Entregar: genera factura y descuenta stock ---------- */
async function openOrderDeliverModal(id) {
  let order;
  try { order = await api('/orders/' + id); }
  catch (err) { return toast(err.message, 'error'); }

  openModal('🚚 Entregar pedido PD-' + String(order.number).padStart(5, '0'), `
    <div class="collect-info">
      <div>
        <strong>${esc(order.customer_name || order.client_name || 'Mostrador')}</strong><br>
        <small>${order.items.length} artículo(s)</small>
      </div>
      <div class="collect-debt">
        <small>Total a cobrar</small>
        <strong>${money(order.total)}</strong>
      </div>
    </div>

    <form id="order-deliver-form">
      <div class="form-grid">
        <div class="full"><label>Forma de pago *</label>
          <select name="payment_method">
            <option value="efectivo">💵 Efectivo</option>
            <option value="tarjeta">💳 Tarjeta</option>
            <option value="transferencia">🏦 Transferencia / Mercado Pago</option>
            <option value="fiado">📝 Fiado (queda debiendo)</option>
          </select></div>
        <p class="form-error"></p>
      </div>
      <p class="config-hint">Se genera la factura y se descuenta el inventario. Si es fiado, la deuda aparece sola en Cobros.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-green">✅ Entregar y facturar</button>
      </div>
    </form>`);

  document.getElementById('order-deliver-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api(`/orders/${id}/deliver`, {
        method: 'POST',
        body: { payment_method: f.payment_method.value }
      });
      closeModal();
      toast(r.message);
      loadOrders();
      printInvoice(r.invoice_id);
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

/* ---------- Comanda imprimible del pedido ---------- */
async function printOrderSlip(id) {
  try {
    const o = await api('/orders/' + id);
    await loadStoreSettings();
    const s = storeSettings;

    document.getElementById('print-area').innerHTML = `
      <div class="invoice-sheet">
        <header class="inv-head">
          <div class="inv-store">
            <h1>${esc(s.store_name)}</h1>
            ${s.phone ? `<p><strong>Tel:</strong> ${esc(s.phone)}</p>` : ''}
            ${s.address ? `<p>${esc(s.address)}</p>` : ''}
          </div>
          <div class="inv-title">
            <h2>PEDIDO PD-${String(o.number).padStart(5, '0')}</h2>
            <p><strong>Tomado:</strong> ${fmtDate(o.created_at)}</p>
            ${o.delivery_date ? `<p><strong>Entrega:</strong> ${fmtDue(o.delivery_date)}</p>` : ''}
          </div>
        </header>

        <div class="inv-sep"></div>

        <div class="inv-meta">
          <div>
            <p><strong>Cliente:</strong> ${esc(o.customer_name || o.client_name || '—')}</p>
            ${o.customer_phone || o.client_phone ? `<p><strong>Teléfono:</strong> ${esc(o.customer_phone || o.client_phone)}</p>` : ''}
            ${o.client_address ? `<p><strong>Dirección:</strong> ${esc(o.client_address)}</p>` : ''}
          </div>
          <div style="text-align:right">
            <p><strong>Tomado por:</strong> ${esc(o.user_name)}</p>
            <p><strong>Vendedor(a):</strong> ${esc((o.seller_name || '—'))}</p>
            <p><strong>Estado:</strong> ${esc((ORDER_STATUS_LABELS[o.status] || o.status).toUpperCase())}</p>
          </div>
        </div>

        <table class="inv-items">
          <thead>
            <tr>
              <th class="c-item">#</th>
              <th>Código</th>
              <th>Descripción</th>
              <th class="t-right">Cant.</th>
              <th class="t-right">Vr. unitario</th>
              <th class="t-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${o.items.map((it, i) => `
              <tr>
                <td class="c-item">${i + 1}</td>
                <td>${esc(it.code) || '—'}</td>
                <td>${esc(it.name)}</td>
                <td class="t-right">${it.quantity}</td>
                <td class="t-right">${money(it.unit_price)}</td>
                <td class="t-right">${money(it.line_total)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5" class="t-right"><strong>Total estimado (${o.items.length} artículo${o.items.length === 1 ? '' : 's'})</strong></td>
              <td class="t-right inv-total-cell"><strong>${money(o.total)}</strong></td>
            </tr>
          </tfoot>
        </table>

        ${o.notes ? `<p class="inv-notes"><strong>Observaciones:</strong> ${esc(o.notes)}</p>` : ''}
        <p class="inv-notes"><em>Este documento es un pedido y NO constituye una factura. Al entregar se emitirá la comprobante correspondiente.</em></p>

        <div class="inv-signatures">
          <div class="sig"><span></span><small>Pidió: ${esc(o.customer_name || o.client_name || '____________')}</small></div>
          <div class="sig"><span></span><small>Tomó el pedido</small></div>
        </div>

        ${s.invoice_footer ? `<footer class="inv-footer">${esc(s.invoice_footer)}</footer>` : ''}
      </div>`;

    window.print();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Eliminar definitivamente (solo admin, pedidos cancelados) ---------- */
async function deleteOrder(id) {
  if (!confirm('¿Eliminar definitivamente este pedido cancelado? No se puede deshacer.')) return;
  try { const r = await api('/orders/' + id, { method: 'DELETE' }); toast(r.message); loadOrders(); }
  catch (err) { toast(err.message, 'error'); }
}
