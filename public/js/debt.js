/* ================= DEUDAS Y DOCUMENTOS (CONTABILIDAD) ================= */

function loadDebtTab() {
  loadDebtReport();
  loadCommitmentsList();
  loadPagaresList();
}

/* --- Helpers para convertir números a letras (español) --- */
function numberToWords(n) {
  if (n === 0) return 'cero';
  const ones = ['','un','dos','tres','cuatro','cinco','seis','siete','ocho','nueve',
    'diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve',
    'veinte','veintiún','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
  const tens = ['','','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  const hundreds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos',
    'seiscientos','setecientos','ochocientos','novecientos'];

  function chunk(num) {
    if (num === 0) return '';
    if (num === 100) return 'cien';
    let r = '';
    const h = Math.floor(num / 100);
    const rest = num % 100;
    if (h > 0) r += hundreds[h];
    if (rest > 0) {
      if (r) r += ' ';
      if (rest < 30) r += ones[rest];
      else {
        const t = Math.floor(rest / 10);
        const u = rest % 10;
        r += tens[t];
        if (u > 0) r += ' y ' + ones[u];
      }
    }
    return r;
  }

  const intPart = Math.floor(n);
  const decPart = Math.round((n - intPart) * 100);
  let result = '';

  if (intPart >= 1000000) {
    const m = Math.floor(intPart / 1000000);
    result += (m === 1 ? 'un' : chunk(m)) + ' millón' + (m > 1 ? 'es' : '');
    const rem = intPart % 1000000;
    if (rem > 0) result += ' ' + (rem < 100 ? '' : '') + chunkFull(rem);
    else return result.trim();
  } else if (intPart >= 1000) {
    const k = Math.floor(intPart / 1000);
    result += (k === 1 ? 'mil' : chunk(k) + ' mil');
    const rem = intPart % 1000;
    if (rem > 0) result += ' ' + chunk(rem);
  } else {
    result = chunk(intPart);
  }

  function chunkFull(num) {
    if (num >= 1000) {
      const k = Math.floor(num / 1000);
      const r = num % 1000;
      let s = (k === 1 ? 'mil' : chunk(k) + ' mil');
      if (r > 0) s += ' ' + chunk(r);
      return s;
    }
    return chunk(num);
  }

  result = result.trim();
  if (decPart > 0) result += ' con ' + decPart + '/100';
  return result;
}

/* --- Reporte de Deudas --- */
async function loadDebtReport() {
  try {
    const d = await api('/accounting/debt-report?from=2024-01-01');

    document.getElementById('acct-debt-report').innerHTML = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
          <h4>📊 Reporte de Deudas desde 2024</h4>
          <button class="btn btn-primary" onclick="printDebtReport()">🖨 Imprimir Reporte</button>
        </div>
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
          <div class="stat-card" style="border-left:4px solid var(--amber)">
            <span class="stat-icon">👥</span>
            <h3>${d.summary.total_clients}</h3>
            <p>Clientes con deuda</p>
          </div>
          <div class="stat-card" style="border-left:4px solid var(--red)">
            <span class="stat-icon">💰</span>
            <h3 class="negative">${money(d.summary.total_owed)}</h3>
            <p>Total adeudado</p>
          </div>
          <div class="stat-card" style="border-left:4px solid var(--green)">
            <span class="stat-icon">✅</span>
            <h3 class="positive">${money(d.summary.total_paid)}</h3>
            <p>Total abonado</p>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:1rem">
          <table>
            <thead><tr>
              <th>Cliente</th><th>Teléfono</th><th>Tipo de deuda</th>
              <th class="t-right">Adeudado</th><th class="t-right">Abonado</th><th class="t-right">Saldo</th>
              <th>Desde</th>
            </tr></thead>
            <tbody>
              ${d.clients.length ? d.clients.map(c => c.debts.map((debt, i) => `
                <tr>
                  ${i === 0 ? `<td rowspan="${c.debts.length}"><strong>${esc(c.client_name)}</strong></td>
                  <td rowspan="${c.debts.length}">${esc(c.client_phone || '—')}</td>` : ''}
                  <td><span class="badge" style="background:#dbeafe;color:#1d4ed8">${esc(debt.type)}</span> ${debt.count > 1 ? `(${debt.count})` : ''}</td>
                  <td class="t-right">${money(debt.owed)}</td>
                  <td class="t-right positive">${money(debt.paid)}</td>
                  <td class="t-right negative"><strong>${money(debt.owed - debt.paid)}</strong></td>
                  ${i === 0 ? `<td rowspan="${c.debts.length}">${c.oldest_date || '—'}</td>` : ''}
                </tr>`).join('')).join('')
                : '<tr class="empty-row"><td colspan="7">No hay deudas pendientes desde 2024.</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="font-weight:700;background:#f8fafc">
                <td colspan="3"><strong>TOTALES (${d.summary.total_clients} clientes)</strong></td>
                <td class="t-right">${money(d.summary.total_owed)}</td>
                <td class="t-right positive">${money(d.summary.total_paid)}</td>
                <td class="t-right negative"><strong>${money(d.summary.total_balance)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;

    window._debtReportData = d;
  } catch (err) { toast(err.message, 'error'); }
}

/* Imprimir reporte de deudas */
async function printDebtReport() {
  const d = window._debtReportData;
  if (!d) return toast('Primero generá el reporte', 'error');
  await loadStoreSettings();
  const s = storeSettings;
  const area = document.getElementById('print-area');

  area.innerHTML = `
    <div class="doc-sheet doc-debt-report">
      <header class="inv-head">
        <div class="inv-store">
          <h1>${esc(s.store_name)}</h1>
          ${s.phone ? `<p><strong>Tel:</strong> ${esc(s.phone)}</p>` : ''}
          ${s.address ? `<p>${esc(s.address)}</p>` : ''}
        </div>
        <div class="inv-title">
          <h2>REPORTE DE DEUDAS</h2>
          <p><strong>Desde:</strong> ${d.from} · <strong>Hasta:</strong> ${d.to}</p>
          <p><strong>Impreso:</strong> ${localDateStr(new Date())}</p>
        </div>
      </header>
      <div class="inv-sep"></div>

      <div class="debt-report-summary">
        <div><strong>Total clientes:</strong> ${d.summary.total_clients}</div>
        <div><strong>Total adeudado:</strong> ${money(d.summary.total_owed)}</div>
        <div><strong>Total abonado:</strong> ${money(d.summary.total_paid)}</div>
        <div><strong>Saldo pendiente:</strong> ${money(d.summary.total_balance)}</div>
      </div>

      <table class="inv-items debt-report-table">
        <thead><tr>
          <th>Cliente</th><th>Teléfono</th><th>Tipo</th>
          <th class="t-right">Adeudado</th><th class="t-right">Abonado</th><th class="t-right">Saldo</th>
          <th>Desde</th>
        </tr></thead>
        <tbody>
          ${d.clients.map(c => c.debts.map((debt, i) => `
            <tr>
              ${i === 0 ? `<td rowspan="${c.debts.length}"><strong>${esc(c.client_name)}</strong></td>
              <td rowspan="${c.debts.length}">${esc(c.client_phone || '—')}</td>` : ''}
              <td>${esc(debt.type)}${debt.count > 1 ? ` (${debt.count})` : ''}</td>
              <td class="t-right">${money(debt.owed)}</td>
              <td class="t-right">${money(debt.paid)}</td>
              <td class="t-right"><strong>${money(debt.owed - debt.paid)}</strong></td>
              ${i === 0 ? `<td rowspan="${c.debts.length}">${c.oldest_date || '—'}</td>` : ''}
            </tr>`).join('')).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td colspan="3"><strong>TOTALES</strong></td>
            <td class="t-right"><strong>${money(d.summary.total_owed)}</strong></td>
            <td class="t-right"><strong>${money(d.summary.total_paid)}</strong></td>
            <td class="t-right"><strong>${money(d.summary.total_balance)}</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div class="inv-signatures" style="margin-top:30mm">
        <div class="sig"><span></span><small>Responsable / Administración</small></div>
        <div class="sig"><span></small><small>Revisado por</small></div>
      </div>

      <footer class="inv-footer">Documento generado por ${esc(s.store_name)} · Reporte de deudas · ${localDateStr(new Date())}</footer>
    </div>`;

  window.print();
}

/* --- Compromisos de Pago --- */
async function loadCommitmentsList() {
  try {
    const list = await api('/accounting/commitments');
    document.getElementById('acct-commitments-list').innerHTML = `
      <div class="panel">
        <h4>📝 Compromisos de Pago Generados</h4>
        ${list.length ? `
          <div class="table-wrap" style="margin-top:.5rem">
            <table>
              <thead><tr><th>N°</th><th>Cliente</th><th>Monto</th><th>Vence</th><th>Creado</th><th style="text-align:right">Acciones</th></tr></thead>
              <tbody>
                ${list.map(c => `
                  <tr>
                    <td><strong>#${c.number}</strong></td>
                    <td>${esc(c.client_name)}</td>
                    <td><strong>${money(c.debt_amount)}</strong></td>
                    <td>${c.due_date || '—'}</td>
                    <td>${fmtDate(c.created_at).slice(0, 10)}</td>
                    <td><div class="actions-cell">
                      <button class="btn btn-outline btn-small" onclick="printCommitment(${c.id})">🖨 Imprimir</button>
                    </div></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`
        : '<p style="color:var(--muted);margin-top:.5rem">No hay compromisos generados aún.</p>'}
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openCommitmentModal() {
  const today = localDateStr(new Date());
  openModal('Nuevo Compromiso de Pago', `
    <form id="commitment-form">
      <div class="form-grid">
        <div class="full"><label>Nombre del cliente *</label><input name="client_name" required placeholder="Nombre y apellido"></div>
        <div><label>Documento (DNI/Cédula)</label><input name="client_document" placeholder="Ej: 12345678"></div>
        <div><label>Teléfono</label><input name="client_phone" placeholder="Ej: 11 2345-6789"></div>
        <div class="full"><label>Dirección</label><input name="client_address" placeholder="Calle y altura, ciudad..."></div>
        <div><label>Monto de la deuda *</label><input name="debt_amount" type="number" min="1" step="any" required placeholder="0"></div>
        <div><label>Fecha límite de pago</label><input name="due_date" type="date" value="${today}"></div>
        <div class="full"><label>Descripción de la deuda</label><input name="debt_description" placeholder="Ej: Mercadería various, ropa, etc."></div>
        <div class="full"><label>Términos / Condiciones especiales</label><input name="terms" placeholder="Opcional: plazo, forma de pago, etc."></div>
        <div class="full"><label>Notas internas</label><input name="notes" placeholder="Solo para registro interno"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">📝 Generar Compromiso</button>
      </div>
    </form>`);

  document.getElementById('commitment-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api('/accounting/commitments', {
        method: 'POST',
        body: Object.fromEntries(new FormData(f))
      });
      closeModal();
      toast(r.message);
      loadCommitmentsList();
      printCommitment(r.id);
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function printCommitment(id) {
  try {
    const c = await api('/accounting/commitments/' + id);
    await loadStoreSettings();
    const s = storeSettings;
    const area = document.getElementById('print-area');
    const dueDate = c.due_date ? new Date(c.due_date + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'A convenir';

    area.innerHTML = `
      <div class="doc-sheet doc-commitment">
        <header class="inv-head">
          <div class="inv-store">
            <h1>${esc(s.store_name)}</h1>
            ${s.phone ? `<p><strong>Tel:</strong> ${esc(s.phone)}</p>` : ''}
            ${s.address ? `<p>${esc(s.address)}</p>` : ''}
          </div>
          <div class="inv-title">
            <h2>COMPROMISO DE PAGO</h2>
            <p><strong>N°:</strong> ${String(c.number).padStart(4, '0')}</p>
            <p><strong>Fecha:</strong> ${localDateStr(new Date())}</p>
          </div>
        </header>
        <div class="inv-sep"></div>

        <div class="commitment-body">
          <p style="text-align:center;font-size:16px;font-weight:700;margin-bottom:8mm">COMPROMISO DE PAGO</p>

          <p style="line-height:1.8;text-align:justify">
            Yo, <strong>${esc(c.client_name)}</strong>
            ${c.client_document ? `, identificado con DNI/Cédula N° <strong>${esc(c.client_document)}</strong>` : ''}
            ${c.client_phone ? `, con teléfono <strong>${esc(c.client_phone)}</strong>` : ''}
            ${c.client_address ? `, domiciliado en <strong>${esc(c.client_address)}</strong>` : ''}
            , me comprometo de manera voluntaria a cancelar la deuda pendiente con <strong>${esc(s.store_name)}</strong>
            por el monto total de <strong>${money(c.debt_amount)}</strong>
            (${numberToWords(c.debt_amount)} pesos),
            ${c.debt_description ? `correspondiente a <em>${esc(c.debt_description)}</em>` : ''}
          </p>

          <p style="line-height:1.8;text-align:justify;margin-top:6mm">
            La fecha límite para la cancelación total de esta deuda será el <strong>${dueDate}</strong>.
            ${c.terms ? `<br><br><strong>Términos adicionales:</strong> ${esc(c.terms)}` : ''}
          </p>

          <p style="line-height:1.8;text-align:justify;margin-top:6mm">
            Me comprometo a efectuar los pagos de la siguiente manera:
          </p>

          <table class="commitment-schedule">
            <thead><tr><th>Fecha</th><th>Concepto</th><th class="t-right">Monto</th></tr></thead>
            <tbody>
              <tr>
                <td>${dueDate}</td>
                <td>Pago total de la deuda</td>
                <td class="t-right"><strong>${money(c.debt_amount)}</strong></td>
              </tr>
            </tbody>
          </table>

          <p style="line-height:1.8;text-align:justify;margin-top:6mm">
            En caso de no cancelar la totalidad de la deuda en la fecha estipulada, me comprometo a
            ponerme al día lo antes posible, coordinando los pagos directamente con <strong>${esc(s.store_name)}</strong>.
          </p>

          ${c.notes ? `<p style="margin-top:4mm"><strong>Observaciones:</strong> ${esc(c.notes)}</p>` : ''}
        </div>

        <div class="inv-signatures" style="margin-top:25mm">
          <div class="sig"><span></span><small>Deudor/a: ${esc(c.client_name)}</small></div>
          <div class="sig"><span></span><small>Acreedor/a: ${esc(s.store_name)}</small></div>
        </div>

        <footer class="inv-footer">
          Documento generado por ${esc(s.store_name)} · Compromiso de Pago N° ${String(c.number).padStart(4, '0')} · ${localDateStr(new Date())}
          ${c.created_by_name ? ' · Creado por: ' + esc(c.created_by_name) : ''}
        </footer>
      </div>`;

    window.print();
  } catch (err) { toast(err.message, 'error'); }
}

/* --- Pagarés Formales --- */
async function loadPagaresList() {
  try {
    const list = await api('/accounting/pagares');
    const isAdmin = currentUser.role === 'admin';
    const STATUS_COLORS = { vigente: '#2563eb', pagado: '#16a34a', cancelado: '#dc2626' };
    const STATUS_LABELS = { vigente: 'Vigente', pagado: 'Pagado', cancelado: 'Cancelado' };

    document.getElementById('acct-pagares-list').innerHTML = `
      <div class="panel">
        <h4>📄 Pagarés Generados</h4>
        ${list.length ? `
          <div class="table-wrap" style="margin-top:.5rem">
            <table>
              <thead><tr><th>N°</th><th>Deudor</th><th>Monto</th><th>Emisión</th><th>Vence</th><th>Estado</th><th style="text-align:right">Acciones</th></tr></thead>
              <tbody>
                ${list.map(p => `
                  <tr>
                    <td><strong>${String(p.number).padStart(3, '0')}</strong></td>
                    <td>${esc(p.client_name)}</td>
                    <td><strong>${money(p.amount)}</strong></td>
                    <td>${p.issue_date}</td>
                    <td>${p.due_date || '—'}</td>
                    <td><span class="badge" style="background:${STATUS_COLORS[p.status]}22;color:${STATUS_COLORS[p.status]}">${STATUS_LABELS[p.status]}</span></td>
                    <td><div class="actions-cell">
                      <button class="btn btn-outline btn-small" onclick="printPagare(${p.id})">🖨 Imprimir</button>
                      ${isAdmin && p.status === 'vigente' ? `
                        <button class="btn btn-green btn-small" onclick="setPagareStatus(${p.id}, 'pagado')">✅ Pagado</button>
                        <button class="btn btn-danger btn-small" onclick="setPagareStatus(${p.id}, 'cancelado')">🚫 Cancelar</button>
                      ` : ''}
                      ${isAdmin && p.status !== 'vigente' ? `
                        <button class="btn btn-outline btn-small" onclick="setPagareStatus(${p.id}, 'vigente')">🔄 Reactivar</button>
                      ` : ''}
                    </div></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`
        : '<p style="color:var(--muted);margin-top:.5rem">No hay pagarés generados aún.</p>'}
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openPagareModal() {
  const today = localDateStr(new Date());
  openModal('Nuevo Pagaré', `
    <form id="pagare-form">
      <div class="form-grid">
        <div class="full"><h4 style="margin:0 0 .5rem;font-size:.9rem;color:var(--muted)">Datos del Deudor</h4></div>
        <div class="full"><label>Nombre del deudor *</label><input name="client_name" required placeholder="Nombre y apellido"></div>
        <div><label>DNI / Cédula</label><input name="client_document" placeholder="Ej: 12345678"></div>
        <div><label>Teléfono</label><input name="client_phone" placeholder="Ej: 11 2345-6789"></div>
        <div class="full"><label>Domicilio</label><input name="client_address" placeholder="Calle y altura, ciudad..."></div>

        <div class="full" style="margin-top:.5rem"><h4 style="margin:0 0 .5rem;font-size:.9rem;color:var(--muted)">Datos del Acreedor</h4></div>
        <div><label>Nombre del acreedor</label><input name="creditor_name" value="${esc(storeSettings.store_name)}" placeholder="Variedades Angie"></div>
        <div><label>Documento del acreedor</label><input name="creditor_document" value="${esc(storeSettings.nit || '')}" placeholder="CUIT / DNI"></div>

        <div class="full" style="margin-top:.5rem"><h4 style="margin:0 0 .5rem;font-size:.9rem;color:var(--muted)">Datos del Pagaré</h4></div>
        <div><label>Monto total *</label><input name="amount" type="number" min="1" step="any" required placeholder="0" oninput="this.closest('form').querySelector('[name=amount_words]').value = this.value ? numberToWords(Math.round(Number(this.value))) : ''"></div>
        <div class="full"><label>Monto en letras</label><input name="amount_words" placeholder="Se completa automáticamente"></div>
        <div><label>Interés mensual (%)</label><input name="interest_rate" type="number" min="0" max="100" step="0.5" value="0"></div>
        <div><label>Fecha de emisión *</label><input name="issue_date" type="date" value="${today}" required></div>
        <div><label>Fecha de vencimiento</label><input name="due_date" type="date"></div>
        <div><label>Origen</label><input name="origin_type" placeholder="Ej: Factura, Tarjeta"></div>
        <div><label>N° de origen</label><input name="origin_number" placeholder="Ej: FV-000123"></div>
        <div class="full"><label>Términos / Condiciones</label><input name="terms" placeholder="Opcional"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">📄 Generar Pagaré</button>
      </div>
    </form>`);

  document.getElementById('pagare-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api('/accounting/pagares', {
        method: 'POST',
        body: Object.fromEntries(new FormData(f))
      });
      closeModal();
      toast(r.message);
      loadPagaresList();
      printPagare(r.id);
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function printPagare(id) {
  try {
    const p = await api('/accounting/pagares/' + id);
    await loadStoreSettings();
    const s = storeSettings;
    const area = document.getElementById('print-area');
    const issueDate = p.issue_date ? new Date(p.issue_date + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : '________';
    const dueDate = p.due_date ? new Date(p.due_date + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : '________';
    const amountWords = p.amount_words || numberToWords(p.amount);

    area.innerHTML = `
      <div class="doc-sheet doc-pagare">
        <div class="doc-title">Pagaré</div>
        <div class="doc-numero">N° ${String(p.number).padStart(3, '0')}</div>

        <div class="doc-text">
          <b>POR ESTE PAGARÉ</b>, ${issueDate.toUpperCase()}, prometo(emos) pagar incondicionalmente y sin protesto a la orden de
          <b>${esc(p.creditor_name || 'EL ACREEDOR')}</b>
          ${p.creditor_document ? `(${esc(p.creditor_document)})` : ''},
          en la ciudad de ${s.address ? esc(s.address) : '____________________'},
          o en el domicilio que se señale, la cantidad de:
        </div>

        <div class="monto-line">${money(p.amount)}</div>
        <div class="monto-letras">(${amountWords})</div>

        <div class="doc-text">
          La presente obligación devengará un interés de <b>${p.interest_rate}%</b> mensual hasta su total
          cancelación y deberá ser pagada a más tardar el día <b>${dueDate}</b>.
          En caso de mora, el deudor se obliga a pagar una penalidad del 1% adicional por cada mes de retraso,
          sin perjuicio de la exigibilidad de la deuda.
          ${p.terms ? `<br><br><b>Términos adicionales:</b> ${esc(p.terms)}` : ''}
        </div>

        <table class="data-table">
          <tr>
            <td class="label">DEUDOR</td>
            <td>
              <b>${esc(p.client_name)}</b><br>
              DNI/Cédula: ${esc(p.client_document || '—')}<br>
              Teléfono: ${esc(p.client_phone || '—')}<br>
              Domicilio: ${esc(p.client_address || '—')}
            </td>
          </tr>
          <tr>
            <td class="label">ACREEDOR</td>
            <td>
              <b>${esc(p.creditor_name || '—')}</b><br>
              Documento: ${esc(p.creditor_document || '—')}
            </td>
          </tr>
          <tr><td class="label">MONTO</td><td>${money(p.amount)}</td></tr>
          <tr><td class="label">INTERÉS</td><td>${p.interest_rate}% mensual</td></tr>
          <tr><td class="label">FECHA DE EMISIÓN</td><td>${issueDate}</td></tr>
          <tr><td class="label">FECHA DE VENCIMIENTO</td><td>${dueDate}</td></tr>
          ${p.origin_type ? `<tr><td class="label">ORIGEN</td><td>${esc(p.origin_type)} ${esc(p.origin_number || '')}</td></tr>` : ''}
        </table>

        <div class="clausulas">
          <b>CLÁUSULAS:</b>
          <ol>
            <li>El presente pagaré es exigible por sí mismo, sin necesidad de protesto o aviso previo.</li>
            <li>El deudor se obliga a pagar el monto total en la fecha de vencimiento señalada, más los intereses compensatorios y moratorios pactados.</li>
            <li>Ante el incumplimiento, el acreedor podrá exigir la totalidad de la deuda mediante vía judicial o extrajudicial.</li>
            <li>Para efectos de cobranza, las partes se someten a los tribunales de su domicilio y al procedimiento de ejecución de títulos valores.</li>
            <li>El presente documento constituye título ejecutivo suficiente conforme a la ley de la materia.</li>
          </ol>
        </div>

        <div class="doc-signatures">
          <div class="sign-box">
            <div class="sign-line">DEUDOR/A</div>
            <div class="sign-role">${esc(p.client_name)}</div>
            <div class="sign-role">DNI: ${esc(p.client_document || '—')}</div>
          </div>
          <div class="sign-box">
            <div class="sign-line">ACREEDOR/A</div>
            <div class="sign-role">${esc(p.creditor_name || '—')}</div>
          </div>
        </div>

        <div class="doc-footer">
          Documento generado por ${esc(s.store_name)} · Pagaré N° ${String(p.number).padStart(3, '0')} · Emitido el ${issueDate}
          ${p.created_by_name ? ' · Registrado por: ' + esc(p.created_by_name) : ''}
        </div>
      </div>`;

    window.print();
  } catch (err) { toast(err.message, 'error'); }
}

async function setPagareStatus(id, status) {
  const labels = { pagado: 'pagado', cancelado: 'cancelado', vigente: 'vigente' };
  if (!confirm(`¿Marcar el pagaré como ${labels[status]}?`)) return;
  try {
    await api('/accounting/pagares/' + id + '/status', { method: 'PUT', body: { status } });
    toast('Estado actualizado');
    loadPagaresList();
  } catch (err) { toast(err.message, 'error'); }
}