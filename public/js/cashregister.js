/* ================= CAJA / ARQUEO ================= */
async function loadCashRegisters() {
  try {
    const [list, current] = await Promise.all([api('/cashregister'), api('/cashregister/current')]);
    const contentEl = document.getElementById('cashregister-content');

    if (current) {
      contentEl.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card" style="border-left:4px solid #22c55e">
            <span class="stat-icon">🟢</span>
            <h3>Caja #${current.number}</h3>
            <p>Abierta por ${esc(current.cashier_name)} · ${fmtDate(current.opened_at)}</p>
          </div>
          <div class="stat-card"><span class="stat-icon">💵</span><h3>${money(current.initial_amount)}</h3><p>Monto inicial</p></div>
          <div class="stat-card"><span class="stat-icon">📈</span><h3 class="positive">${money(current.total_income)}</h3><p>Ingresos</p></div>
          <div class="stat-card"><span class="stat-icon">📉</span><h3 class="negative">${money(current.total_expenses)}</h3><p>Egresos</p></div>
          <div class="stat-card"><span class="stat-icon">🧮</span><h3>${money(current.expected_total)}</h3><p>Total esperado</p></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <button class="btn btn-primary" onclick="openCashMovementModal(${current.id})">＋ Registrar movimiento</button>
          <button class="btn btn-danger" onclick="closeCashRegisterModal(${current.id})">🔒 Cerrar caja (arqueo)</button>
          <button class="btn btn-outline" onclick="viewCashRegister(${current.id})">👁 Ver movimientos</button>
        </div>`;
    } else {
      contentEl.innerHTML = '<p class="config-hint">No hay caja abierta. Abrí una para empezar a registrar ingresos y egresos.</p>';
    }

    document.getElementById('cashregisters-table').innerHTML = `
      <thead><tr><th>Caja</th><th>Fecha apertura</th><th>Cajero</th><th>Inicial</th><th>Ingresos</th><th>Egresos</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th>Estado</th><th style="text-align:right">Acciones</th></tr></thead>
      <tbody>
        ${list.length ? list.map(cr => {
          const diffClass = cr.difference > 0 ? 'positive' : cr.difference < 0 ? 'negative' : '';
          const diffLabel = cr.status === 'cerrada'
            ? (cr.difference > 0 ? `<span class="positive">+$${Math.abs(cr.difference).toFixed(2)}</span>` : cr.difference < 0 ? `<span class="negative">-$${Math.abs(cr.difference).toFixed(2)}</span>` : '$0.00')
            : '—';
          return `<tr>
            <td><strong>#${cr.number}</strong></td>
            <td>${fmtDate(cr.opened_at)}</td>
            <td>${esc(cr.cashier_name)}</td>
            <td>${money(cr.initial_amount)}</td>
            <td class="positive">${money(cr.total_income)}</td>
            <td class="negative">${money(cr.total_expenses)}</td>
            <td>${money(cr.expected_total)}</td>
            <td>${cr.counted_amount != null ? money(cr.counted_amount) : '—'}</td>
            <td class="${diffClass}">${diffLabel}</td>
            <td><span class="badge status-${cr.status === 'abierta' ? 'pagada' : 'anulada'}">${cr.status === 'abierta' ? 'ABIERTA' : 'CERRADA'}</span></td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick="viewCashRegister(${cr.id})">👁</button>
              ${currentUser.role === 'admin' && cr.status === 'cerrada' ? `<button class="btn btn-outline btn-small" onclick="reopenCashRegister(${cr.id})">🔓 Reabrir</button>` : ''}
              ${currentUser.role === 'admin' && cr.status === 'cerrada' ? `<button class="btn btn-danger btn-small" onclick="deleteCashRegister(${cr.id})">🗑</button>` : ''}
            </div></td>
          </tr>`;
        }).join('')
          : '<tr class="empty-row"><td colspan="11">No hay cajas registradas</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openCashRegisterModal() {
  openModal('Abrir nueva caja', `
    <form id="cashregister-form">
      <div class="form-grid">
        <div class="full"><label>Monto inicial *</label><input name="initial_amount" type="number" min="0" step="any" required placeholder="0"></div>
        <div class="full"><label>Observación</label><input name="open_notes" placeholder="Ej: Apertura del lunes..."></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Abrir caja</button>
      </div>
    </form>`);
  document.getElementById('cashregister-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api('/cashregister', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal(); toast(r.message); loadCashRegisters();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

function openCashMovementModal(crId) {
  const concepts = {
    ingreso: ['Venta de contado', 'Abono de fiado', 'Transferencia recibida', 'Otro ingreso'],
    egreso: ['Gasto operativo', 'Retiro de caja', 'Pago a proveedor', 'Otro egreso']
  };
  openModal('Registrar movimiento', `
    <form id="cashmovement-form">
      <div class="form-grid">
        <div><label>Tipo *</label>
          <select name="type" id="cm-type">
            <option value="ingreso">📈 Ingreso</option>
            <option value="egreso">📉 Egreso</option>
          </select></div>
        <div><label>Concepto *</label>
          <select name="concept" id="cm-concept">
            ${concepts.ingreso.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select></div>
        <div class="full"><label>Monto *</label><input name="amount" type="number" min="0.01" step="any" required placeholder="0"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Registrar</button>
      </div>
    </form>`);
  document.getElementById('cm-type').addEventListener('change', function () {
    document.getElementById('cm-concept').innerHTML = concepts[this.value].map(c => `<option value="${c}">${c}</option>`).join('');
  });
  document.getElementById('cashmovement-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api(`/cashregister/${crId}/movements`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal(); toast('Movimiento registrado'); loadCashRegisters();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

function closeCashRegisterModal(crId) {
  openModal('Cerrar caja (arqueo)', `
    <form id="closecash-form">
      <div class="form-grid">
        <div class="full"><label>Monto contado (lo que hay en la caja) *</label><input name="counted_amount" type="number" min="0" step="any" required placeholder="0"></div>
        <div class="full"><label>Observación del cierre</label><input name="close_notes" placeholder="Detalle del arqueo..."></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger">Cerrar caja</button>
      </div>
    </form>`);
  document.getElementById('closecash-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api(`/cashregister/${crId}/close`, { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal();
      if (r.difference > 0) toast(`Caja cerrada. Sobrante: $${r.difference.toFixed(2)}`, 'success');
      else if (r.difference < 0) toast(`Caja cerrada. Faltante: $${Math.abs(r.difference).toFixed(2)}`, 'error');
      else toast('Caja cerrada. Todo cuadra');
      loadCashRegisters();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function viewCashRegister(crId) {
  try {
    const cr = await api('/cashregister/' + crId);
    const isOpen = cr.status === 'abierta';
    openModal(`Caja #${cr.number} — ${cr.status.toUpperCase()}`, `
      <div class="stats-grid" style="margin-bottom:12px">
        <div class="stat-card"><span class="stat-icon">💵</span><h3>${money(cr.initial_amount)}</h3><p>Inicial</p></div>
        <div class="stat-card"><span class="stat-icon">📈</span><h3 class="positive">${money(cr.total_income)}</h3><p>Ingresos</p></div>
        <div class="stat-card"><span class="stat-icon">📉</span><h3 class="negative">${money(cr.total_expenses)}</h3><p>Egresos</p></div>
        <div class="stat-card"><span class="stat-icon">🧮</span><h3>${money(cr.expected_total)}</h3><p>Esperado</p></div>
      </div>
      ${cr.status === 'cerrada' ? `<p class="config-hint">Cerrada por ${esc(cr.closed_by)} · Contado: ${money(cr.counted_amount)} · Diferencia: ${cr.difference >= 0 ? '+' : ''}$${cr.difference.toFixed(2)}${cr.close_notes ? ' · ' + esc(cr.close_notes) : ''}</p>` : ''}
      <table class="mini-table">
        <thead><tr><th>#</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Registrado por</th><th>Fecha</th>${isOpen ? '<th></th>' : ''}</tr></thead>
        <tbody>
          ${cr.movements.length ? cr.movements.map(m => `
            <tr>
              <td>${m.id}</td>
              <td><span class="badge type-${m.type === 'ingreso' ? 'entrada' : 'salida'}">${m.type === 'ingreso' ? 'INGRESO' : 'EGRESO'}</span></td>
              <td>${esc(m.concept)}</td>
              <td class="${m.type === 'ingreso' ? 'positive' : 'negative'}">${m.type === 'ingreso' ? '+' : '-'}${money(m.amount)}</td>
              <td>${esc(m.user_name || '—')}</td>
              <td>${fmtDate(m.created_at)}</td>
              ${isOpen ? `<td><button class="btn btn-danger btn-small" onclick="deleteCashMovement(${cr.id}, ${m.id})">🗑</button></td>` : ''}
            </tr>`).join('')
            : '<tr class="empty-row"><td colspan="6">Sin movimientos</td></tr>'
          }
        </tbody>
      </table>
      <div class="form-actions" style="margin-top:12px">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cerrar</button>
      </div>
    `, { wide: true });
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteCashMovement(crId, mid) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    await api(`/cashregister/${crId}/movements/${mid}`, { method: 'DELETE' });
    toast('Movimiento eliminado'); viewCashRegister(crId); loadCashRegisters();
  } catch (err) { toast(err.message, 'error'); }
}

async function reopenCashRegister(crId) {
  if (!confirm('¿Reabrir esta caja?')) return;
  try { await api(`/cashregister/${crId}/reopen`, { method: 'POST' }); toast('Caja reabierta'); loadCashRegisters(); }
  catch (err) { toast(err.message, 'error'); }
}

async function deleteCashRegister(crId) {
  if (!confirm('¿Eliminar esta caja? Esta acción no se puede deshacer.')) return;
  try { await api('/cashregister/' + crId, { method: 'DELETE' }); toast('Caja eliminada'); loadCashRegisters(); }
  catch (err) { toast(err.message, 'error'); }
}
