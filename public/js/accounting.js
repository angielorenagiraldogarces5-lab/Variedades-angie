/* ================= CONTABILIDAD ================= */
const ACCT_TYPES = { activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio', ingreso: 'Ingreso', gasto: 'Gasto' };
const ACCT_COLORS = { activo: '#2563eb', pasivo: '#dc2626', patrimonio: '#7c3aed', ingreso: '#16a34a', gasto: '#d97706' };

let currentAcctTab = 'resumen';
let acctSearchTimer;

function debouncedLoadJournal() { clearTimeout(acctSearchTimer); acctSearchTimer = setTimeout(loadJournalEntries, 300); }

function initAccountingView() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  // Set default dates for all tabs
  for (const prefix of ['diario', 'resultado', 'flujo']) {
    const fromEl = document.getElementById(`acct-${prefix}-from`);
    const toEl = document.getElementById(`acct-${prefix}-to`);
    if (fromEl && !fromEl.value) fromEl.value = firstDay;
    if (toEl && !toEl.value) toEl.value = lastDay;
  }
  const balanceDate = document.getElementById('acct-balance-date');
  if (balanceDate && !balanceDate.value) balanceDate.value = today;

  loadAccountingSummary();
}

function switchAccountingTab(tab) {
  currentAcctTab = tab;
  document.querySelectorAll('#acct-tabs .tab-btn').forEach((btn, i) => {
    const tabs = ['resumen', 'diario', 'resultado', 'balance', 'flujo', 'cuentas', 'deudas'];
    btn.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.acct-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('acct-tab-' + tab)?.classList.remove('hidden');

  if (tab === 'resumen') loadAccountingSummary();
  if (tab === 'diario') loadJournalEntries();
  if (tab === 'resultado') loadIncomeStatement();
  if (tab === 'balance') loadBalanceSheet();
  if (tab === 'flujo') loadCashFlow();
  if (tab === 'cuentas') loadAccounts();
  if (tab === 'deudas') loadDebtTab();
}

/* Resumen contable */
async function loadAccountingSummary() {
  try {
    const s = await api('/accounting/summary');
    const utilidad = (s.ventas_mes.total || 0) - s.egresos_mes - (s.fiados_pendientes.total || 0);

    document.getElementById('acct-summary-stats').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card" style="border-left:4px solid var(--green)">
          <span class="stat-icon">📈</span>
          <h3 class="positive">${money(s.ventas_mes.total)}</h3>
          <p>Ventas del mes (${s.ventas_mes.count} facturas)</p>
        </div>
        <div class="stat-card" style="border-left:4px solid var(--amber)">
          <span class="stat-icon">📝</span>
          <h3>${money(s.fiados_pendientes.total)}</h3>
          <p>Fiados por cobrar (${s.fiados_pendientes.count})</p>
        </div>
        <div class="stat-card" style="border-left:4px solid var(--red)">
          <span class="stat-icon">📉</span>
          <h3 class="negative">${money(s.egresos_mes)}</h3>
          <p>Egresos del mes</p>
        </div>
        <div class="stat-card" style="border-left:4px solid #2563eb">
          <span class="stat-icon">💵</span>
          <h3>${money(s.caja_disponible)}</h3>
          <p>Caja disponible</p>
        </div>
        <div class="stat-card" style="border-left:4px solid #7c3aed">
          <span class="stat-icon">📦</span>
          <h3>${money(s.inventario.cost)}</h3>
          <p>Inventario (${s.inventario.count} productos)</p>
        </div>
        <div class="stat-card" style="border-left:4px solid #0ea5e9">
          <span class="stat-icon">📒</span>
          <h3>${s.asientos_contables}</h3>
          <p>Asientos contables registrados</p>
        </div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <h4>📅 Período contable</h4>
        <div style="padding:1rem">
          <p><strong>Desde:</strong> ${s.periodo.desde || 'Sin datos'} · <strong>Hasta:</strong> ${s.periodo.hasta || 'Sin datos'}</p>
          <p style="margin-top:.5rem;color:var(--muted);font-size:.88rem">Los asientos se generan automáticamente desde facturas, caja y cobros de fiados. Podés crear asientos manuales desde la pestaña "Libro Diario".</p>
        </div>
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

/* Generar todos los asientos de un período */
async function generateAllEntries() {
  const from = document.getElementById('acct-diario-from')?.value || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = document.getElementById('acct-diario-to')?.value || new Date().toISOString().slice(0, 10);

  if (!confirm(`¿Generar asientos contables desde ${from} hasta ${to}?\n\nSe crearán asientos automáticamente desde:\n• Facturas pagadas y pendientes\n• Movimientos de caja\n• Cobros de fiados\n\nLos asientos ya generados no se duplicarán.`)) return;

  try {
    const r = await api('/accounting/generate-all', { method: 'POST', body: { from, to } });
    toast(r.message);
    loadAccountingSummary();
  } catch (err) { toast(err.message, 'error'); }
}

/* Libro Diario */
async function loadJournalEntries() {
  try {
    const params = new URLSearchParams();
    const from = document.getElementById('acct-diario-from')?.value;
    const to = document.getElementById('acct-diario-to')?.value;
    const search = document.getElementById('acct-diario-search')?.value.trim();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (search) params.set('search', search);

    const entries = await api('/accounting/journal?' + params.toString());

    document.getElementById('acct-journal-table').innerHTML = `
      <thead><tr>
        <th>Asiento</th><th>Fecha</th><th>Descripción</th><th>Fuente</th>
        <th class="t-right">Débito</th><th class="t-right">Crédito</th>
        <th>Registrado por</th><th style="text-align:right">Acciones</th>
      </tr></thead>
      <tbody>
        ${entries.length ? entries.map(e => `
          <tr>
            <td><strong>#${e.number}</strong></td>
            <td>${e.date}</td>
            <td>${esc(e.description)}</td>
            <td><span class="badge" style="background:#dbeafe;color:#1d4ed8">${esc(e.source || 'manual')}</span></td>
            <td class="t-right positive">${money(e.total_debit || 0)}</td>
            <td class="t-right negative">${money(e.total_credit || 0)}</td>
            <td>${esc(e.user_name || '—')}</td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick="viewJournalEntry(${e.id})">👁 Ver</button>
              ${e.source === 'manual' ? `<button class="btn btn-danger btn-small" onclick="deleteJournalEntry(${e.id})">🗑</button>` : ''}
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="8">No hay asientos contables en este período.<br>Usá <strong>"Generar asientos del período"</strong> para crearlos automáticamente.</td></tr>'}
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

async function viewJournalEntry(id) {
  try {
    const e = await api('/accounting/journal/' + id);
    openModal(`Asiento #${e.number} — ${e.date}`, `
      <p style="margin:0 0 .5rem;color:var(--muted)">${esc(e.description)}</p>
      <p style="margin:0 0 1rem;font-size:.85rem">Fuente: <strong>${esc(e.source || 'manual')}</strong> · Registrado por: <strong>${esc(e.user_name || '—')}</strong></p>
      <table class="mini-table">
        <thead><tr>
          <th>Cuenta</th><th>Tipo</th><th class="t-right">Débito</th><th class="t-right">Crédito</th><th>Detalle</th>
        </tr></thead>
        <tbody>
          ${e.lines.map(l => `
            <tr>
              <td><code style="background:#f1f5f9;padding:.1rem .35rem;border-radius:5px;font-size:.8rem">${esc(l.account_code)}</code> <strong>${esc(l.account_name)}</strong></td>
              <td><span class="badge" style="background:${ACCT_COLORS[l.account_type]}22;color:${ACCT_COLORS[l.account_type]}">${ACCT_TYPES[l.account_type]}</span></td>
              <td class="t-right ${l.debit > 0 ? 'positive' : ''}">${l.debit > 0 ? money(l.debit) : '—'}</td>
              <td class="t-right ${l.credit > 0 ? 'negative' : ''}">${l.credit > 0 ? money(l.credit) : '—'}</td>
              <td>${esc(l.description || '—')}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="2"><strong>TOTAL</strong></td>
          <td class="t-right positive"><strong>${money(e.lines.reduce((s, l) => s + l.debit, 0))}</strong></td>
          <td class="t-right negative"><strong>${money(e.lines.reduce((s, l) => s + l.credit, 0))}</strong></td>
          <td></td>
        </tr></tfoot>
      </table>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cerrar</button>
      </div>
    `, { wide: true });
  } catch (err) { toast(err.message, 'error'); }
}

/* Asiento manual */
async function openJournalEntryModal() {
  const accounts = await api('/accounting/accounts');
  const today = new Date().toISOString().slice(0, 10);

  openModal('Nuevo asiento contable', `
    <form id="journal-form">
      <div class="form-grid">
        <div><label>Fecha *</label><input type="date" name="date" value="${today}" required></div>
        <div class="full"><label>Descripción *</label><input name="description" required placeholder="Ej: Pago de alquiler mensual"></div>
      </div>
      <h4 style="margin:1rem 0 .5rem;font-size:.9rem">Líneas del asiento (mínimo 2)</h4>
      <div id="journal-lines" class="acct-lines"></div>
      <button type="button" class="btn btn-outline" onclick="addJournalLine()" style="margin-top:.5rem">＋ Agregar línea</button>
      <p class="form-error" style="margin-top:.5rem"></p>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Registrar asiento</button>
      </div>
    </form>`);

  window._acctAccounts = accounts;
  addJournalLine();
  addJournalLine();

  document.getElementById('journal-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const lines = [];
    document.querySelectorAll('#journal-lines .acct-line').forEach(row => {
      const accountId = Number(row.querySelector('[name=account_id]').value);
      const debit = Number(row.querySelector('[name=debit]').value) || 0;
      const credit = Number(row.querySelector('[name=credit]').value) || 0;
      const desc = row.querySelector('[name=line_desc]').value;
      if (accountId) lines.push({ account_id: accountId, debit, credit, description: desc });
    });

    try {
      await api('/accounting/journal', {
        method: 'POST',
        body: { date: f.date.value, description: f.description.value, lines }
      });
      closeModal(); toast('Asiento registrado'); loadJournalEntries();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

function addJournalLine() {
  const container = document.getElementById('journal-lines');
  const idx = container.children.length;
  const div = document.createElement('div');
  div.className = 'acct-line';
  div.innerHTML = `
    <select name="account_id" required>
      <option value="">— Cuenta —</option>
      ${window._acctAccounts.map(a => `<option value="${a.id}">${a.code} — ${esc(a.name)}</option>`).join('')}
    </select>
    <input name="debit" type="number" min="0" step="any" placeholder="Débito" oninput="this.closest('.acct-line').querySelector('[name=credit]').value = this.value ? '' : ''">
    <input name="credit" type="number" min="0" step="any" placeholder="Crédito" oninput="this.closest('.acct-line').querySelector('[name=debit]').value = this.value ? '' : ''">
    <input name="line_desc" placeholder="Detalle (opcional)">
    <button type="button" class="btn btn-danger btn-small" onclick="this.closest('.acct-line').remove()">🗑</button>
  `;
  container.appendChild(div);
}

async function deleteJournalEntry(id) {
  if (!confirm('¿Eliminar este asiento manual?')) return;
  try { await api('/accounting/journal/' + id, { method: 'DELETE' }); toast('Asiento eliminado'); loadJournalEntries(); }
  catch (err) { toast(err.message, 'error'); }
}

/* Estado de Resultados */
async function loadIncomeStatement() {
  try {
    const from = document.getElementById('acct-resultado-from')?.value;
    const to = document.getElementById('acct-resultado-to')?.value;
    if (!from || !to) return;

    const d = await api(`/accounting/income-statement?from=${from}&to=${to}`);

    const utilidadClass = d.utilidad_neta >= 0 ? 'positive' : 'negative';

    document.getElementById('acct-income-statement').innerHTML = `
      <div class="panel acct-report">
        <h4>📈 Estado de Resultados — ${d.period.from} al ${d.period.to}</h4>
        <div class="acct-report-body">
          <div class="acct-row"><span>Ventas Brutas</span><strong class="positive">${money(d.ventas_brutas)}</strong></div>
          <div class="acct-row"><span>(−) Costo de Mercadería Vendida</span><strong class="negative">−${money(d.costo_mercaderia)}</strong></div>
          <div class="acct-row acct-total"><span>UTILIDAD BRUTA</span><strong class="${d.utilidad_bruta >= 0 ? 'positive' : 'negative'}">${money(d.utilidad_bruta)}</strong></div>

          <div class="acct-sep"></div>

          <div class="acct-row"><span>Ingresos por cobro de fiados</span><strong>${money(d.ingresos_fiados)}</strong></div>
          <div class="acct-row"><span>(−) Comisiones de vendedores</span><strong class="negative">−${money(d.comisiones)}</strong></div>

          <div class="acct-sep"></div>
          <div class="acct-row acct-subtitle"><span>Gastos Operativos</span><strong></strong></div>
          ${d.gastos_detalle.map(g => `
            <div class="acct-row acct-indent"><span>${esc(g.concept)}</span><strong class="negative">−${money(g.total)}</strong></div>
          `).join('')}
          <div class="acct-row"><span>Total Gastos Operativos</span><strong class="negative">−${money(d.gastos_operativos)}</strong></div>

          <div class="acct-sep"></div>
          <div class="acct-row acct-total acct-grand"><span>UTILIDAD NETA</span><strong class="${utilidadClass}">${money(d.utilidad_neta)}</strong></div>
        </div>
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

/* Balance General */
async function loadBalanceSheet() {
  try {
    const date = document.getElementById('acct-balance-date')?.value;
    if (!date) return;

    const d = await api(`/accounting/balance-sheet?date=${date}`);

    document.getElementById('acct-balance-sheet').innerHTML = `
      <div class="panel acct-report">
        <h4>⚖️ Balance General al ${d.date}</h4>
        <div class="acct-report-body">
          <div class="acct-row acct-subtitle"><span>ACTIVOS</span><strong></strong></div>
          <div class="acct-row acct-indent"><span>Caja General</span><strong>${money(d.activos.caja)}</strong></div>
          <div class="acct-row acct-indent"><span>Cuentas por Cobrar (Fiados)</span><strong>${money(d.activos.cuentas_por_cobrar)}</strong></div>
          <div class="acct-row acct-indent"><span>Inventario de Mercaderías</span><strong>${money(d.activos.inventario)}</strong></div>
          <div class="acct-row acct-total"><span>TOTAL ACTIVOS</span><strong>${money(d.activos.total)}</strong></div>

          <div class="acct-sep"></div>

          <div class="acct-row acct-subtitle"><span>PASIVOS</span><strong></strong></div>
          <div class="acct-row acct-indent"><span>Cuentas por Pagar</span><strong>${money(d.pasivos.total)}</strong></div>
          <div class="acct-row acct-total"><span>TOTAL PASIVOS</span><strong>${money(d.pasivos.total)}</strong></div>

          <div class="acct-sep"></div>

          <div class="acct-row acct-subtitle"><span>PATRIMONIO</span><strong></strong></div>
          <div class="acct-row acct-indent"><span>Capital Social</span><strong>${money(d.patrimonio.capital)}</strong></div>
          <div class="acct-row acct-indent"><span>Resultados Acumulados</span><strong>${money(d.patrimonio.resultados_acumulados)}</strong></div>
          <div class="acct-row acct-indent"><span>Resultados del Ejercicio</span><strong class="${d.patrimonio.resultados_ejercicio >= 0 ? 'positive' : 'negative'}">${money(d.patrimonio.resultados_ejercicio)}</strong></div>
          <div class="acct-row acct-total"><span>TOTAL PATRIMONIO</span><strong>${money(d.patrimonio.total)}</strong></div>

          <div class="acct-sep"></div>

          <div class="acct-row acct-grand"><span>PASIVOS + PATRIMONIO</span><strong>${money(d.pasivos.total + d.patrimonio.total)}</strong></div>
        </div>
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

/* Flujo de Caja */
async function loadCashFlow() {
  try {
    const from = document.getElementById('acct-flujo-from')?.value;
    const to = document.getElementById('acct-flujo-to')?.value;
    if (!from || !to) return;

    const d = await api(`/accounting/cash-flow?from=${from}&to=${to}`);

    const PAYMENT_LABELS = { efectivo: '💵 Efectivo', tarjeta: '💳 Tarjeta', transferencia: '🏦 Transferencia', fiado: '📝 Fiado' };

    document.getElementById('acct-cash-flow').innerHTML = `
      <div class="panel acct-report">
        <h4>💧 Flujo de Caja — ${d.period.from} al ${d.period.to}</h4>
        <div class="acct-report-body">
          <div class="acct-row acct-subtitle"><span>ENTRADAS</span><strong></strong></div>
          ${d.ingresos_ventas.map(v => `
            <div class="acct-row acct-indent"><span>${PAYMENT_LABELS[v.payment_method] || v.payment_method} (${v.count} ventas)</span><strong class="positive">${money(v.total)}</strong></div>
          `).join('')}
          <div class="acct-row acct-indent"><span>Cobros de fiados</span><strong class="positive">${money(d.ingresos_fiados)}</strong></div>
          <div class="acct-row acct-total"><span>TOTAL ENTRADAS DE CAJA</span><strong class="positive">${money(d.ingresos_caja + d.ingresos_fiados)}</strong></div>

          <div class="acct-sep"></div>

          <div class="acct-row acct-subtitle"><span>SALIDAS</span><strong></strong></div>
          ${d.egresos_detalle.map(e => `
            <div class="acct-row acct-indent"><span>${esc(e.concept)}</span><strong class="negative">−${money(e.total)}</strong></div>
          `).join('')}
          <div class="acct-row acct-total"><span>TOTAL SALIDAS DE CAJA</span><strong class="negative">−${money(d.egresos_caja)}</strong></div>

          <div class="acct-sep"></div>
          <div class="acct-row acct-grand"><span>FLUJO NETO DE CAJA</span><strong class="${d.flujo_neto >= 0 ? 'positive' : 'negative'}">${d.flujo_neto >= 0 ? '+' : ''}${money(d.flujo_neto)}</strong></div>
        </div>
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

/* Plan de Cuentas */
async function loadAccounts() {
  try {
    const accounts = await api('/accounting/accounts');
    const isAdmin = currentUser.role === 'admin';

    document.getElementById('acct-accounts-table').innerHTML = `
      <thead><tr>
        <th>Código</th><th>Nombre</th><th>Tipo</th><th>Movimientos</th>
        ${isAdmin ? '<th style="text-align:right">Acciones</th>' : ''}
      </tr></thead>
      <tbody>
        ${accounts.length ? accounts.map(a => `
          <tr>
            <td><code style="background:#f1f5f9;padding:.15rem .45rem;border-radius:5px;font-size:.85rem">${esc(a.code)}</code></td>
            <td><strong>${esc(a.name)}</strong></td>
            <td><span class="badge" style="background:${ACCT_COLORS[a.type]}22;color:${ACCT_COLORS[a.type]}">${ACCT_TYPES[a.type]}</span></td>
            <td>${a.usage_count || 0}</td>
            ${isAdmin ? `<td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick='openAccountModal(${JSON.stringify({ id: a.id, code: a.code, name: a.name, type: a.type })})'>✏️ Editar</button>
              ${a.usage_count === 0 ? `<button class="btn btn-danger btn-small" onclick="deleteAccount(${a.id}, '${esc(a.name).replace(/'/g, "\\'")}')">🗑</button>` : ''}
            </div></td>` : ''}
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="5">No hay cuentas configuradas</td></tr>'}
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openAccountModal(account = null) {
  openModal(account ? 'Editar cuenta' : 'Nueva cuenta', `
    <form id="account-form">
      <div class="form-grid">
        <div><label>Código *</label><input name="code" required value="${esc(account?.code || '')}" placeholder="Ej: 5207" ${account ? 'readonly' : ''}></div>
        <div><label>Tipo *</label>
          <select name="type" required>
            ${Object.entries(ACCT_TYPES).map(([k, v]) => `<option value="${k}" ${account?.type === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></div>
        <div class="full"><label>Nombre *</label><input name="name" required value="${esc(account?.name || '')}" placeholder="Ej: Servicio de limpieza"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  document.getElementById('account-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const body = Object.fromEntries(new FormData(f));
    try {
      account ? await api('/accounting/accounts/' + account.id, { method: 'PUT', body })
               : await api('/accounting/accounts', { method: 'POST', body });
      closeModal(); toast('Cuenta guardada'); loadAccounts();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function deleteAccount(id, name) {
  if (!confirm(`¿Eliminar la cuenta "${name}"?`)) return;
  try { await api('/accounting/accounts/' + id, { method: 'DELETE' }); toast('Cuenta eliminada'); loadAccounts(); }
  catch (err) { toast(err.message, 'error'); }
}
