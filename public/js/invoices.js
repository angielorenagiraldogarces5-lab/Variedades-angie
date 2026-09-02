/* ================= FACTURAS ================= */
async function loadInvoices() {
  try {
    const params = new URLSearchParams();
    if (document.getElementById('invoice-status-filter').value) params.set('status', document.getElementById('invoice-status-filter').value);
    if (document.getElementById('invoice-from').value) params.set('from', document.getElementById('invoice-from').value);
    if (document.getElementById('invoice-to').value) params.set('to', document.getElementById('invoice-to').value);

    const invoices = await api('/invoices?' + params.toString());
    const isAdmin = currentUser.role === 'admin';

    document.getElementById('invoices-table').innerHTML = `
      <thead><tr>
        <th>Número</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th>Productos</th><th>Total</th><th>Pago</th><th>Estado</th><th style="text-align:right">Acciones</th>
      </tr></thead>
      <tbody>
        ${invoices.length ? invoices.map(i => `
          <tr>
            <td><strong>FV-${String(i.number).padStart(6, '0')}</strong></td>
            <td>${fmtDate(i.created_at)}</td>
            <td>${esc(i.customer_name || i.client_name || 'Mostrador')}</td>
            <td>${esc(i.seller_name || '—')}${i.commission_amount > 0 ? `<br><small style="color:var(--muted)">comisión ${money(i.commission_amount)} (${Math.round(i.commission_rate)}%)</small>` : ''}</td>
            <td>${i.item_count}</td>
            <td><strong>${money(i.total)}</strong></td>
            <td><span class="badge pay-${i.payment_method}">${i.payment_method}</span></td>
            <td><span class="badge status-${i.status}">${i.status}</span></td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick="printInvoice(${i.id})">🖨 Imprimir / PDF</button>
              ${i.status === 'pendiente' ? `<button class="btn btn-primary btn-small" onclick="payInvoice(${i.id})">✅ Cobrar</button>` : ''}
              ${isAdmin && i.status !== 'anulada' ? `<button class="btn btn-danger btn-small" onclick="voidInvoice(${i.id})">🚫 Anular</button>` : ''}
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="9">No hay facturas registradas. ¡Ve a "Facturar" para crear la primera!</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

async function payInvoice(id) {
  if (!confirm('¿Confirmas que el cliente ya pagó esta factura?')) return;
  try { const r = await api(`/invoices/${id}/pay`, { method: 'POST' }); toast(r.message); loadInvoices(); }
  catch (err) { toast(err.message, 'error'); }
}

async function voidInvoice(id) {
  if (!confirm('¿Anular esta factura? El stock de los productos será devuelto al inventario.')) return;
  try { const r = await api(`/invoices/${id}/void`, { method: 'POST' }); toast(r.message); loadInvoices(); }
  catch (err) { toast(err.message, 'error'); }
}

async function deleteAllInvoices() {
  if (!confirm('⚠️ ELIMINAR TODO EL HISTORIAL DE FACTURAS\n\nSe borrarán TODAS las facturas. El stock será devuelto al inventario.\n\n¿Continuar?')) return;
  if (!confirm('¿Estás SEGURO? Esta acción no se puede deshacer.')) return;
  try {
    const r = await fetch('/api/invoices', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    toast(r.message);
    loadInvoices();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Plantilla compartida de la hoja de factura ---------- */
function invoiceSheetHtml(inv, s) {
  const number = inv.number ? 'FV-' + String(inv.number).padStart(6, '0') : 'BORRADOR';
  return `
    <div class="invoice-sheet inv-large ${inv.status === 'anulada' ? 'is-voided' : ''}">
      <header class="inv-head">
        <div class="inv-store">
          <h1>${esc(s.store_name)}</h1>
          ${s.nit ? `<p><strong>CUIT:</strong> ${esc(s.nit)}</p>` : ''}
          ${s.address ? `<p><strong>Dirección:</strong> ${esc(s.address)}</p>` : ''}
          ${s.phone ? `<p><strong>Teléfono:</strong> ${esc(s.phone)}</p>` : ''}
        </div>
        <div class="inv-title">
          <h2>FACTURA DE VENTA</h2>
          <p><strong>N°:</strong> ${number}</p>
          <p><strong>Fecha:</strong> ${inv.created_at}</p>
        </div>
      </header>

      <div class="inv-sep"></div>

      <div class="inv-meta">
        <div>
          <p><strong>Cliente:</strong> ${esc(inv.customer_name || inv.client_name || 'Mostrador')}</p>
          ${(inv.customer_phone || (!inv.customer_id && inv.client_phone)) ? `<p><strong>Teléfono:</strong> ${esc(inv.customer_phone || inv.client_phone)}</p>` : ''}
          ${(!inv.customer_id && inv.client_email) ? `<p><strong>Email:</strong> ${esc(inv.client_email)}</p>` : ''}
          ${(!inv.customer_id && inv.client_address) ? `<p><strong>Dirección:</strong> ${esc(inv.client_address)}</p>` : ''}
        </div>
        <div style="text-align:right">
          <p class="inv-seller"><strong>Vendedor(a):</strong> ${esc((inv.seller_name || inv.user_name).toUpperCase())}</p>
          ${inv.commission_amount > 0 ? `<p><strong>Comisión:</strong> ${money(inv.commission_amount)} (${Math.round(inv.commission_rate)}% de la venta)</p>` : ''}
          <p><strong>Atendido por:</strong> ${esc(inv.user_name)}</p>
          <p><strong>Forma de pago:</strong> ${esc(inv.payment_method.toUpperCase())}</p>
          <p><strong>Estado:</strong> ${esc(inv.status.toUpperCase())}${inv.paid_at ? ' (pagada el ' + fmtDate(inv.paid_at) + ')' : ''}</p>
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
          ${inv.items.map((it, i) => `
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
            <td colspan="5" class="t-right"><strong>Total (${inv.items.length} artículo${inv.items.length === 1 ? '' : 's'})</strong></td>
            <td class="t-right inv-total-cell"><strong>${money(inv.total)}</strong></td>
          </tr>
        </tfoot>
      </table>

      ${!inv.number ? `<p class="inv-alert">*** VISTA PREVIA — VENTA AÚN NO REGISTRADA ***</p>` : ''}
      ${inv.notes ? `<p class="inv-notes"><strong>Observaciones:</strong> ${esc(inv.notes)}</p>` : ''}
      ${inv.status === 'pendiente' && inv.number ? '<p class="inv-alert">*** FACTURA PENDIENTE DE PAGO (FIADO) ***</p>' : ''}
      ${inv.status === 'anulada' ? '<div class="inv-void-stamp">FACTURA ANULADA</div>' : ''}

      <div class="inv-signatures">
        <div class="sig"><span></span><small>Entregó</small></div>
        <div class="sig"><span></span><small>Recibió conformidad</small></div>
      </div>

      ${s.invoice_footer ? `<footer class="inv-footer">${esc(s.invoice_footer)}</footer>` : ''}
    </div>`;
}

async function printInvoice(id) {
  try {
    const inv = await api('/invoices/' + id);
    await loadStoreSettings();
    document.getElementById('print-area').innerHTML = invoiceSheetHtml(inv, storeSettings);
    window.print();
  } catch (err) { toast(err.message, 'error'); }
}

/* Imprime la venta actual como vista previa, sin registrarla */
async function printPosDraft() {
  if (!cart.size) return toast('No hay productos en la venta para imprimir', 'error');
  await loadStoreSettings();
  const sellerId = Number(document.getElementById('pos-seller').value);
  const seller = posSellers.find(u => u.id === sellerId);
  const items = [...cart.values()].map(e => ({
    code: e.kind === 'product' ? (e.product.code || '') : '',
    name: e.kind === 'product' ? e.product.name : e.name,
    unit_price: Number(e.price ?? e.product?.sale_price) || 0,
    quantity: e.qty,
    line_total: Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty)
  }));
  const custSel = document.getElementById('pos-customer');
  const hasCustomer = !!custSel.value;
  document.getElementById('print-area').innerHTML = invoiceSheetHtml({
    number: null,
    created_at: localDateStr(new Date()),
    customer_name: hasCustomer ? (custSel.selectedOptions[0]?.textContent || '') : '',
    client_name: document.getElementById('pos-client-name').value.trim(),
    client_address: document.getElementById('pos-client-address').value.trim(),
    client_phone: document.getElementById('pos-client-phone').value.trim(),
    client_email: document.getElementById('pos-client-email').value.trim(),
    user_name: currentUser.full_name,
    seller_name: seller?.full_name || currentUser.full_name,
    commission_rate: 0,
    commission_amount: 0,
    payment_method: document.getElementById('pos-payment').value,
    status: 'pagada',
    items,
    total: cartTotal()
  }, storeSettings);
  window.print();
}