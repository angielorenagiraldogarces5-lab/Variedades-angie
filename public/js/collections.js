/* ================= COBROS (TARJETAS DE FIADOS) ================= */
let collectionsTimer;
let cobrosTab = 'manuales';

const PAY_TYPE_LABELS = { semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual', colaborador: 'Colaborador' };

function debouncedLoadCollections() { clearTimeout(collectionsTimer); collectionsTimer = setTimeout(loadCollections, 300); }

function switchCollectionsTab(tab) {
  cobrosTab = tab;
  document.getElementById('tab-manuales').classList.toggle('active', tab === 'manuales');
  document.getElementById('tab-facturas').classList.toggle('active', tab === 'facturas');
  document.getElementById('manual-cards-grid').classList.toggle('hidden', tab !== 'manuales');
  document.getElementById('customer-cards-grid').classList.toggle('hidden', tab !== 'facturas');
  document.getElementById('collection-status-filter').classList.toggle('hidden', tab !== 'manuales');
  document.getElementById('collections-hint').textContent = tab === 'manuales'
    ? 'Las tarjetas manuales las creas tú con "＋ Nueva tarjeta": anotas el fiado con sus datos y vas registrando los abonos.'
    : 'Estas tarjetas se generan solas cuando facturas con pago "Fiado". Entra a cada cliente para abonar o saldar sus facturas.';
  loadCollections();
}

async function loadCollections() {
  try {
    const params = new URLSearchParams();
    const s = document.getElementById('collection-search').value.trim();
    if (s) params.set('search', s);
    if (cobrosTab === 'manuales') {
      const st = document.getElementById('collection-status-filter').value;
      if (st) params.set('status', st);
    }
    if (document.getElementById('collection-old-filter').checked) params.set('old', '1');

    const d = await api('/collections?' + params.toString());

    document.getElementById('collections-summary').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><span class="stat-icon">💸</span><h3>${money(d.totals.total_debt)}</h3><p>Total por cobrar</p></div>
        <div class="stat-card"><span class="stat-icon">📝</span><h3>${money(d.totals.manual_debt)}</h3><p>En tarjetas manuales</p></div>
        <div class="stat-card"><span class="stat-icon">🧾</span><h3>${money(d.totals.invoice_debt)}</h3><p>En facturas fiadas</p></div>
        <div class="stat-card"><span class="stat-icon">✅</span><h3>${money(d.totals.collected_month)}</h3><p>Cobrado este mes</p></div>
        <div class="stat-card ${d.totals.old_debt > 0 ? 'stat-alert' : ''}"><span class="stat-icon">⏰</span><h3>${money(d.totals.old_debt)}</h3><p>Con más de 90 días sin pagar</p></div>
      </div>`;

    renderManualCards(d.manual_cards);
    renderCustomerCards(d.customer_cards);
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Tarjetas manuales ---------- */
const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/* "2026-08-24" -> "lun 24/08/26" */
function fmtDue(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const d = new Date(iso + 'T00:00:00');
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}

/* Badge con el próximo cobro automático de la tarjeta */
function dueBadgeHtml(sch) {
  if (!sch) return '';
  const when = fmtDue(sch.next_due_date);
  if (sch.is_due_today) return `<span class="badge due-today">⏰ ¡COBRAR HOY! · cobro #${sch.next_due_number}</span>`;
  if (sch.days_late > 0) return `<span class="badge out" title="Cobro #${sch.next_due_number - 1} quedó atrás sin registrar">⏰ Atrasado ${sch.days_late}d · #${sch.next_due_number}: ${when}</span>`;
  return `<span class="badge due-soon">📅 Cobro #${sch.next_due_number}: ${when}</span>`;
}

function renderManualCards(cards) {
  const box = document.getElementById('manual-cards-grid');
  box.innerHTML = cards.length ? cards.map(c => {
    const balance = c.amount - c.paid_amount;
    const pct = Math.min(100, Math.round((c.paid_amount / c.amount) * 100));
    const isOld = c.status === 'pendiente' && c.days_old >= 90;
    const isBlocked = c.is_blocked;
    return `
      <div class="debt-card manual ${c.status}${isBlocked ? ' blocked' : ''}">
        <div class="debt-info">
          <div class="debt-card-top">
            <span class="avatar">${esc(c.customer_name.trim().charAt(0).toUpperCase())}</span>
            <div class="debt-card-id">
              <h4 title="${esc(c.customer_name)}">${esc(c.customer_name)}${isBlocked ? ' <span class="badge" style="background:#dc2626;color:#fff;margin-left:4px">🚫 BLOQUEADO</span>' : ''}</h4>
              <small>${esc(c.phone || c.city || 'Sin contacto')}${c.created_by ? ` · ✍️ Registró: ${esc(c.created_by)}` : ''}</small>
            </div>
            <span class="badge pt-${c.payment_type}">${PAY_TYPE_LABELS[c.payment_type]}</span>
          </div>
          <div class="card-article">${c.item_count > 0
            ? `<strong>${esc(c.first_item)}</strong>${c.item_count > 1 ? ` <span class="badge ok more-items">+${c.item_count - 1} más</span>` : ''}`
            : `${c.item_code ? `<code>${esc(c.item_code)}</code>` : ''} ${esc(c.item_name || 'Sin artículo indicado')}`}</div>
          ${dueBadgeHtml(c.schedule)}
          ${isOld ? `<span class="badge out" title="Fiado del ${c.fiado_date} sin saldarse">🔴 Fiado antiguo: ${c.days_old} días (${esc(String(c.fiado_date))})</span>` : ''}
        </div>
        <div class="debt-money">
          <span class="debt-amount">${money(balance)}</span>
          <div class="pay-progress" title="${money(c.paid_amount)} pagado de ${money(c.amount)}"><div style="width:${pct}%"></div></div>
          <small>de ${money(c.amount)} · fiado del ${c.fiado_date}${c.city ? ' · ' + esc(c.city) : ''}</small>
        </div>
        ${c.status === 'pendiente'
          ? `<div class="card-btn-row">
               <button class="btn btn-primary" onclick="openCardDetail(${c.id})">💵 Ver tarjeta y abonar</button>
               <button class="btn btn-outline" title="Imprimir tarjeta de cobro" onclick="printManualCard(${c.id})">🖨</button>
             </div>`
          : `<div class="card-btn-row">
               <button class="btn btn-outline" onclick="openCardDetail(${c.id})">👀 Ver tarjeta</button>
               <button class="btn btn-outline" title="Imprimir tarjeta de cobro" onclick="printManualCard(${c.id})">🖨</button>
             </div>`}
      </div>`;
  }).join('')
  : '<p class="pos-empty" style="grid-column:1/-1;padding:3rem 0">No hay tarjetas aquí. Crea la primera con "＋ Nueva tarjeta".</p>';
}

/* ============ ESTUDIO CREDITICIO PREVIO PARA CREAR FIADOS ============ */
function openCreditStudyBeforeFiado(onApproved) {
  openModal('🛡️ Estudio de Crédito — Verificación previa', `
    <div class="credit-study-modal">
      <p class="config-hint" style="margin-bottom:.8rem">Ingresa el nombre del cliente para verificar su estado crediticio antes de crear el fiado.</p>
      <div class="credit-study-search">
        <input type="text" id="cs-name" placeholder="Nombre del cliente..." maxlength="80" autofocus>
        <button class="btn btn-primary" id="cs-verify-btn">🔍 Verificar</button>
      </div>
      <div id="cs-result" class="credit-study-result"></div>
    </div>`);

  const input = document.getElementById('cs-name');
  const btn = document.getElementById('cs-verify-btn');
  const doSearch = () => runCreditStudy(onApproved);
  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
}

async function runCreditStudy(onApproved) {
  const name = document.getElementById('cs-name')?.value.trim();
  if (!name) return;
  const box = document.getElementById('cs-result');
  box.className = 'credit-study-result visible';
  box.innerHTML = '<div class="credit-study-loading"><div class="spinner"></div><br>Consultando historial crediticio...</div>';

  try {
    const history = await api('/credit/history/' + encodeURIComponent(name));
    renderCreditStudyResult(history, onApproved);
  } catch {
    renderCreditStudyNewClient(name, onApproved);
  }
}

function renderCreditStudyNewClient(name, onApproved) {
  const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const box = document.getElementById('cs-result');
  box.innerHTML = `
    <div class="credit-study-header new-client">
      <div class="credit-study-avatar">${initials}</div>
      <div>
        <p class="credit-study-name">${esc(name)}</p>
        <p class="credit-study-sub">Cliente nuevo — sin historial crediticio previo</p>
      </div>
      <span class="credit-study-decision" style="background:#2563eb">NUEVO</span>
    </div>
    <div class="credit-study-body">
      <div class="credit-study-factors">
        <div class="credit-study-factor info"><span>📋</span> Sin historial previo — se evaluará con el primer fiado</div>
      </div>
      <p style="margin:0;font-size:.82rem;color:var(--muted)">Este cliente no tiene facturas fiadas, tarjetas ni fiados del día registrados. Puedes continuar con la creación.</p>
    </div>
    <div class="credit-study-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="cs-continue-btn">✅ Continuar y crear fiado</button>
    </div>`;
  document.getElementById('cs-continue-btn').addEventListener('click', () => { closeModal(); onApproved(name); });
}

function renderCreditStudyResult(h, onApproved) {
  const box = document.getElementById('cs-result');
  const r = h.risk || { level: 'bajo', decision: 'aprobado', factors: [], total_transactions: 0, overdue_count: 0, on_time_count: 0, max_debt: 0 };
  const deuda = h.totals.deuda_actual;
  const initials = h.customer_name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  const isBlocked = !!h.blocked;
  const headerClass = isBlocked ? 'blocked' : r.decision === 'denegado' ? 'blocked' : r.decision === 'revision' ? 'warning' : 'ok';
  const decisionLabels = { aprobado: '✅ APROBADO', revision: '⚠️ EN REVISIÓN', denegado: '🚫 DENEGADO' };
  const decisionColors = { aprobado: 'var(--green)', revision: 'var(--amber)', denegado: 'var(--red)' };
  const riskIcons = { alto: '🔴', medio: '🟡', bajo: '🟢' };

  let html = `
    <div class="credit-study-header ${headerClass}">
      <div class="credit-study-avatar">${initials}</div>
      <div>
        <p class="credit-study-name">${esc(h.customer_name)}</p>
        <p class="credit-study-sub">${riskIcons[r.level] || '🟢'} Riesgo: ${r.level.toUpperCase()} · Score: ${h.score}%</p>
      </div>
      <span class="credit-study-decision" style="background:${isBlocked ? 'var(--red)' : decisionColors[r.decision]}">${isBlocked ? '🚫 BLOQUEADO' : decisionLabels[r.decision]}</span>
    </div>
    <div class="credit-study-body">
      <div class="credit-study-kpis">
        <div class="credit-study-kpi">
          <span class="credit-study-kpi-icon">📊</span>
          <div><span class="credit-study-kpi-value">${r.total_transactions}</span><span class="credit-study-kpi-label">Transacciones</span></div>
        </div>
        <div class="credit-study-kpi">
          <span class="credit-study-kpi-icon">💰</span>
          <div><span class="credit-study-kpi-value">${money(h.totals.total_fiado)}</span><span class="credit-study-kpi-label">Total fiado</span></div>
        </div>
        <div class="credit-study-kpi">
          <span class="credit-study-kpi-icon">✅</span>
          <div><span class="credit-study-kpi-value green">${money(h.totals.total_pagado)}</span><span class="credit-study-kpi-label">Total pagado</span></div>
        </div>
        <div class="credit-study-kpi">
          <span class="credit-study-kpi-icon">🔴</span>
          <div><span class="credit-study-kpi-value ${deuda > 0 ? 'red' : ''}">${money(deuda)}</span><span class="credit-study-kpi-label">Deuda actual</span></div>
        </div>
      </div>`;

  if (isBlocked) {
    html += `
      <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:.7rem .9rem;margin-bottom:.7rem">
        <strong style="color:#991b1b">⛔ CLIENTE BLOQUEADO</strong><br>
        <span style="font-size:.82rem;color:#991b1b">Motivo: ${esc(h.blocked.reason || 'Sin especificar')} · Desde ${fmtDate(h.blocked.blocked_at)}</span>
      </div>`;
  }

  if (deuda > 0 && !isBlocked) {
    html += `
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:.7rem .9rem;margin-bottom:.7rem">
        <strong style="color:#92400e">⚠️ DEUDA PENDIENTE</strong><br>
        <span style="font-size:.82rem;color:#92400e">El cliente debe ${money(deuda)} por créditos anteriores.</span>
      </div>`;
  }

  if (r.factors.length) {
    html += '<div class="credit-study-factors">';
    for (const f of r.factors) {
      html += `<div class="credit-study-factor ${f.type}"><span>${f.icon}</span> ${esc(f.label)}</div>`;
    }
    html += '</div>';
  }

  const canContinue = !isBlocked && r.decision !== 'denegado';

  if (canContinue) {
    html += `<p style="margin:0;font-size:.82rem;color:var(--muted)">Puedes continuar con la creación del fiado para este cliente.</p>`;
  } else {
    html += `<p style="margin:0;font-size:.82rem;color:var(--red);font-weight:600">${isBlocked ? 'No se puede crear fiado: el cliente está bloqueado. Desbloquealo primero desde Estudio Crediticio.' : 'No se recomienda crear un nuevo fiado para este cliente. Riesgo alto.'}</p>`;
  }

  html += `
    </div>
    <div class="credit-study-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      ${canContinue ? `<button class="btn btn-primary" id="cs-continue-btn">✅ Continuar y crear fiado</button>` : ''}
      ${isBlocked ? `<button class="btn btn-green" id="cs-unblock-btn">🔓 Desbloquear cliente</button>` : ''}
    </div>`;

  box.innerHTML = html;

  if (canContinue) {
    document.getElementById('cs-continue-btn').addEventListener('click', () => { closeModal(); onApproved(h.customer_name); });
  }
  if (isBlocked) {
    document.getElementById('cs-unblock-btn').addEventListener('click', async () => {
      showUnblockPasswordModal(async () => {
        try {
          await api('/credit/blacklist/' + h.blocked.id, { method: 'DELETE' });
          toast('Cliente desbloqueado');
          runCreditStudy(onApproved);
        } catch (err) { toast(err.error || err.message, 'error'); }
      });
    });
  }
}

function openCardModal(card = null, skipStudy = false, prefilledName = '') {
  if (!card && !skipStudy) {
    return openCreditStudyBeforeFiado((name) => openCardModal(null, true, name));
  }
  openModal(card ? 'Editar tarjeta de cobro' : 'Nueva tarjeta de cobro', `
    <form id="fcard-form">
      <div class="form-grid">
        <div class="full"><label>Nombre del cliente *</label><input name="customer_name" required maxlength="80" value="${esc(card?.customer_name || prefilledName || '')}" placeholder="Ej: María Gómez"></div>
        <div><label>Teléfono</label><input name="phone" maxlength="40" value="${esc(card?.phone || '')}"></div>
        <div><label>Ciudad</label><input name="city" maxlength="60" value="${esc(card?.city || '')}"></div>
        <div class="full"><label>Dirección</label><input name="address" maxlength="120" value="${esc(card?.address || '')}" placeholder="Calle y altura, ciudad..."></div>
        <div><label>Código del artículo</label><input name="item_code" maxlength="40" value="${esc(card?.item_code || '')}"></div>
        <div><label>Nombre del artículo</label><input name="item_name" maxlength="80" value="${esc(card?.item_name || '')}"></div>
        <div><label>Fecha del fiado *</label><input name="fiado_date" type="date" required value="${card?.fiado_date || localDateStr(new Date())}"></div>
        <div><label>Forma de pago *</label>
          <select name="payment_type" required>
            <option value="semanal" ${(card?.payment_type || 'semanal') === 'semanal' ? 'selected' : ''}>📅 Semanal</option>
            <option value="quincenal" ${card?.payment_type === 'quincenal' ? 'selected' : ''}>📆 Quincenal</option>
            <option value="mensual" ${card?.payment_type === 'mensual' ? 'selected' : ''}>🗓 Mensual</option>
            <option value="colaborador" ${card?.payment_type === 'colaborador' ? 'selected' : ''}>👥 Colaborador</option>
          </select></div>
        <div><label>Valor a cobrar *</label><input name="amount" type="number" step="any" min="1" required value="${card?.amount ?? ''}"></div>
        ${card && card.paid_amount > 0 ? `<div><label>Ya abonado (no editable)</label><input value="${money(card.paid_amount)}" readonly disabled></div>` : '<div></div>'}
        <div class="full"><label>Notas</label><input name="notes" maxlength="200" value="${esc(card?.notes || '')}" placeholder="Observaciones del fiado..."></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">${card ? 'Guardar cambios' : 'Crear tarjeta'}</button>
      </div>
    </form>`);

  document.getElementById('fcard-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      card ? await api('/collections/cards/' + card.id, { method: 'PUT', body: Object.fromEntries(new FormData(f)) })
           : await api('/collections/cards', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal(); toast(card ? 'Tarjeta actualizada' : 'Tarjeta creada'); loadCollections();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function openCardDetail(id) {
  try {
    const c = await api('/collections/cards/' + id);
    currentDetailCard = c;
    const isAdmin = currentUser.role === 'admin';
    const balance = c.amount - c.paid_amount;

    openModal('Tarjeta de cobro — ' + c.customer_name, `
      <div class="collect-info">
        <div>
          <strong>${esc(c.customer_name)}</strong><br>
          <small>${esc([c.phone, c.address, c.city].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
        </div>
        <div class="collect-debt">
          <small>Saldo pendiente</small>
          <strong>${money(balance)}</strong>
        </div>
      </div>

      <div class="card-info">
        <div><strong>Fecha del fiado</strong>${c.fiado_date}${(c.status === 'pendiente' && c.days_old >= 90) ? `<br><span class="badge out">🔴 ${c.days_old} días sin pagar</span>` : ''}</div>
        <div><strong>Forma de pago</strong><span class="badge pt-${c.payment_type}">${PAY_TYPE_LABELS[c.payment_type]}</span></div>
        <div><strong>Artículos</strong>${c.items.length ? c.items.length + ' en la tarjeta' : esc((c.item_code ? c.item_code + ' — ' : '') + (c.item_name || 'No indicado'))}</div>
        <div><strong>Total / Abonado</strong>${money(c.amount)} / ${money(c.paid_amount)}</div>
        <div><strong>Fiado registrado por</strong>${esc(c.created_by || '—')}</div>
      </div>

      <div id="card-credit-info"></div>

      ${c.schedule ? `
      <div class="due-box">
        <div class="due-next">
          <span>📅 <strong>Próximo cobro:</strong> #${c.schedule.next_due_number} — ${fmtDue(c.schedule.next_due_date)}
          ${c.schedule.is_due_today ? '<span class="badge due-today">¡HOY!</span>' : ''}
          ${c.schedule.days_late > 0 ? `<span class="badge out">Atrasado ${c.schedule.days_late} día(s)</span>` : ''}</span>
        </div>
        <ul class="due-list">
          ${c.schedule.upcoming.map(u => `
            <li${u.date === c.schedule.next_due_date ? ' class="next"' : ''}>
              <span>Cobro #${u.number}</span><strong>${fmtDue(u.date)}</strong>
            </li>`).join('')}
        </ul>
      </div>` : ''}

      ${c.items.length ? `
      <table class="mini-table">
        <thead><tr><th>Cant.</th><th>Artículo</th><th class="t-right">Vr. unitario</th><th class="t-right">Total</th></tr></thead>
        <tbody>
          ${c.items.map(it => `
            <tr>
              <td>${it.quantity}</td>
              <td>${esc(it.name)}${it.code ? ` <code>${esc(it.code)}</code>` : ''}</td>
              <td class="t-right">${money(it.unit_price)}</td>
              <td class="t-right">${money(it.line_total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : ''}

      ${c.notes ? `<p class="config-hint">📌 ${esc(c.notes)}</p>` : ''}

      <h4 class="collect-sub">Pagos registrados</h4>
      ${c.payments.length ? `
        <ul class="pay-history">
          ${c.payments.map(p => {
            const day = fmtDate(p.created_at).slice(0, 10);
            const when = p.payment_date || day;
            const extra = p.payment_date && p.payment_date !== day ? ` · anotado ${fmtDue(day)}` : '';
            return `
            <li>
              <strong class="positive">${money(p.amount)}</strong> · ${esc(p.method)}<br>
              <small>${fmtDue(when)}${extra} · 👤 Cobró: ${esc(p.user_name || '—')}${p.notes ? ' · ' + esc(p.notes) : ''}</small>
            </li>`; }).join('')}
        </ul>`
        : '<p class="pos-empty" style="padding:.5rem 0">Todavía no registran abonos.</p>'}

      ${c.status === 'pendiente' ? `
      <form id="card-payment-form">
        <div class="form-grid">
          <div><label>Monto del abono *</label><input name="amount" type="number" step="any" min="1" max="${balance}" required placeholder="Máximo ${balance}"></div>
          <div><label>Forma de pago</label>
            <select name="method">
              <option value="efectivo">💵 Efectivo</option>
              <option value="transferencia">🏦 Transferencia</option>
              <option value="otro">📝 Otro</option>
            </select></div>
          <div><label>Fecha del cobro *</label><input name="payment_date" type="date" value="${localDateStr(new Date())}" max="${localDateStr(new Date())}" required></div>
          <div class="full"><label>Observación</label><input name="notes" maxlength="120" placeholder="Ej: abona semana 3..."></div>
          <p class="form-error"></p>
        </div>
      </form>` : ''}

      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="printManualCard(${c.id})">🖨 Imprimir tarjeta</button>
        ${c.status === 'pendiente' ? `<button type="button" class="btn btn-green" onclick="openAddItemsModal(${c.id})">＋ Agregar productos</button>` : ''}
        ${c.status === 'pendiente' ? `<button type="button" class="btn btn-outline" onclick="openCardModal(currentDetailCard)">✏️ Editar</button>` : ''}
        ${isAdmin && c.status === 'pendiente' ? `<button type="button" class="btn btn-outline btn-small" onclick="voidCard(${c.id})">🚫 Anular</button>` : ''}
        ${isAdmin && c.status === 'anulada' ? `<button type="button" class="btn btn-green btn-small" onclick="reactivateCard(${c.id})">♻️ Reactivar</button>` : ''}
        ${isAdmin ? `<button type="button" class="btn btn-danger btn-small" onclick="deleteCard(${c.id}, '${esc(c.customer_name).replace(/'/g, "\\'")}')">🗑</button>` : ''}
        ${c.status === 'pendiente' ? '<button class="btn btn-primary" onclick="document.getElementById(\'card-payment-form\').requestSubmit()">💵 Registrar abono</button>' : ''}
      </div>
    `, { wide: true });

    const form = document.getElementById('card-payment-form');
    if (form) form.addEventListener('submit', ev => {
      ev.preventDefault();
      registerManualPayment(c.id, new FormData(ev.target), ev.target);
    });

    // Cargar info crediticia del cliente
    const creditBox = document.getElementById('card-credit-info');
    if (creditBox) {
      try {
        const cr = await api('/collections/credit-check/' + encodeURIComponent(c.customer_name));
        const riskIcons = { bajo: '🟢', medio: '🟡', alto: '🔴' };
        creditBox.innerHTML = `
          <div style="margin:12px 0;padding:12px;border-radius:8px;background:${cr.blocked ? '#fef2f2' : '#f0fdf4'};border:1px solid ${cr.blocked ? '#fca5a5' : '#bbf7d0'}">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:13px">📊 Histórico crediticio:</strong>
              ${cr.blocked ? '<span class="badge" style="background:#dc2626;color:#fff">🚫 BLOQUEADO</span>' : '<span class="badge ok">✅ Activo</span>'}
              ${cr.score !== null ? `<span class="badge">Score: ${cr.score}%</span>` : ''}
              ${cr.risk_level ? `<span class="badge">${riskIcons[cr.risk_level] || ''} Riesgo ${cr.risk_level.toUpperCase()}</span>` : ''}
              ${cr.deuda_actual > 0 ? `<span class="badge out">Deuda total: ${money(cr.deuda_actual)}</span>` : ''}
              ${cr.overdue_count > 0 ? `<span class="badge out">${cr.overdue_count} deuda(s) vencida(s)</span>` : ''}
              ${cr.total_transactions > 0 ? `<span class="badge">${cr.total_transactions} transacción(es)</span>` : ''}
            </div>
            ${cr.blocked ? `<p style="margin:6px 0 0;font-size:12px;color:#b91c1c">Motivo: ${esc(cr.blocked_info?.reason || 'Sin motivo')} — Desbloquear desde Estudio Crediticio</p>` : ''}
          </div>`;
      } catch {
        creditBox.innerHTML = '';
      }
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function registerManualPayment(id, formData, form) {
  try {
    const r = await api(`/collections/cards/${id}/payments`, {
      method: 'POST',
      body: Object.fromEntries(formData)
    });
    toast(r.message);
    loadCollections();
    openCardDetail(id);
  } catch (err) { form.querySelector('.form-error').textContent = err.message; }
}

/* ---------- Agregar productos a una tarjeta ya hecha ---------- */
const cardItemsCart = new Map();
const CARD_ITEM_PRODUCTS = new Map(); /* id -> producto (evita JSON dentro del onclick) */
let currentDetailCard = null;
let cardItemsUid = 0;
let cardItemSearchTimer;
let addItemsCardId = null;

function openAddItemsModal(id) {
  addItemsCardId = id;
  cardItemsCart.clear();
  cardItemsUid = 0;

  openModal('Agregar productos a la tarjeta', `
    <p class="config-hint" id="ci-card-info">Cargando tarjeta...</p>
    <div class="pos-grid" style="grid-template-columns:1fr;gap:.75rem">
      <input type="search" id="ci-search" placeholder="Buscar producto por nombre o código..." oninput="debouncedCardItemSearch()">
      <button type="button" class="btn btn-outline btn-block" onclick="addCardItemFree()">✍️ Agregar artículo escrito a mano</button>
      <div id="ci-results" class="pos-products" style="max-height:180px"></div>
      <div id="ci-staging"></div>
      <p class="form-error" id="ci-error" style="color:var(--red)"></p>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn-primary" onclick="saveCardItems()">＋ Agregar a la tarjeta</button>
    </div>
  `);

  renderCardItemsStaging();
  loadCard(id).then(c => {
    document.getElementById('ci-card-info').innerHTML =
      `<strong>${esc(c.customer_name)}</strong> · saldo actual: ${money(c.amount - c.paid_amount)} de ${money(c.amount)} — lo que agregues <strong>aumenta el total</strong>`;
  }).catch(err => { toast(err.message, 'error'); closeModal(); });

  debouncedCardItemSearch();
}

async function loadCard(id) { return api('/collections/cards/' + id); }

function debouncedCardItemSearch() {
  clearTimeout(cardItemSearchTimer);
  cardItemSearchTimer = setTimeout(async () => {
    try {
      const s = document.getElementById('ci-search')?.value.trim() || '';
      const products = await api('/products' + (s ? '?search=' + encodeURIComponent(s) : ''));
      const box = document.getElementById('ci-results');
      if (!box) return;
      box.innerHTML = products.length ? products.map(p => {
        CARD_ITEM_PRODUCTS.set(p.id, { id: p.id, code: p.code || '', name: p.name, price: p.sale_price });
        return `
        <button type="button" class="pos-product" onclick="addCardItemProductById(${p.id})">
          <span class="pos-stock">Stock: ${p.stock}</span>
          <strong>${esc(p.name)}</strong>
          <small>${esc(p.code || 'sin código')}</small>
          <span class="pos-price">${money(p.sale_price)}</span>
        </button>`;
      }).join('')
        : '<p class="pos-empty">No se encontraron productos</p>';
    } catch (err) {
      const box2 = document.getElementById('ci-results');
      if (box2) box2.innerHTML = '<p class="pos-empty">⚠️ Error al buscar productos: ' + esc(err.message) + '</p>';
    }
  }, 250);
}

function addCardItemProductById(id) {
  const p = CARD_ITEM_PRODUCTS.get(id);
  if (p) addCardItemProduct(p);
}

function addCardItemProduct(p) {
  const entry = [...cardItemsCart.values()].find(e => e.productId === p.id);
  if (entry) { entry.qty++; } 
  else {
    cardItemsCart.set(++cardItemsUid, {
      uid: cardItemsUid, productId: p.id, code: p.code, name: p.name, price: p.price, qty: 1
    });
  }
  renderCardItemsStaging();
}

function addCardItemFree() {
  cardItemsCart.set(++cardItemsUid, { uid: cardItemsUid, productId: null, code: '', name: '', price: '', qty: 1 });
  renderCardItemsStaging(true);
}

function updateCardItem(uid, field, value) {
  const e = cardItemsCart.get(uid);
  if (!e) return;
  if (field === 'name') e.name = String(value).slice(0, 120);
  if (field === 'price') e.price = value === '' ? '' : Math.max(0, Number(value));
  if (field === 'qty') {
    const q = parseInt(value, 10);
    e.qty = Number.isInteger(q) && q > 0 ? q : 1;
  }
  renderCardItemsStaging();
}

function changeCardItemQty(uid, delta) {
  const e = cardItemsCart.get(uid);
  if (!e) return;
  e.qty += delta;
  if (e.qty <= 0) cardItemsCart.delete(uid);
  renderCardItemsStaging();
}

function removeCardItem(uid) { cardItemsCart.delete(uid); renderCardItemsStaging(); }

function cardItemsTotal() {
  let t = 0;
  for (const e of cardItemsCart.values()) t += Math.round((Number(e.price) || 0) * e.qty);
  return t;
}

function renderCardItemsStaging(focusFirstFree = false) {
  const box = document.getElementById('ci-staging');
  if (!box) return;
  box.innerHTML = cardItemsCart.size ? `
    ${[...cardItemsCart.values()].map(e => `
      <div class="pos-cart-item${e.productId ? '' : ' free-item'}">
        <div class="${e.productId ? 'ci-name' : 'ci-free'}">
          ${e.productId
            ? `<strong>${esc(e.name)}</strong>`
            : `<input type="text" class="ci-free-name" maxlength="120" placeholder="Nombre del artículo..." value="${esc(e.name)}" onchange="updateCardItem(${e.uid}, 'name', this.value)">`}
          <div class="ci-free-row">
            <label>Precio
              <input type="number" min="0" step="any" value="${e.price}" onchange="updateCardItem(${e.uid}, 'price', this.value)">
            </label>
            <label>Cant.
              <input type="number" min="1" step="1" value="${e.qty}" onchange="updateCardItem(${e.uid}, 'qty', this.value)">
            </label>
            <span class="ci-total">${money((Number(e.price) || 0) * e.qty)}</span>
          </div>
        </div>
        <div class="qty-controls">
          <button type="button" onclick="changeCardItemQty(${e.uid}, -1)">−</button>
          <button type="button" onclick="changeCardItemQty(${e.uid}, 1)">＋</button>
        </div>
        <button type="button" class="close-btn" title="Quitar" onclick="removeCardItem(${e.uid})">✕</button>
      </div>`).join('')}
    <div class="pos-total-row"><span>Total a agregar</span><strong>${money(cardItemsTotal())}</strong></div>`
    : '<p class="pos-empty">Toca un producto o escribe un artículo para agregarlo.</p>';

  if (focusFirstFree) {
    const first = box.querySelector('.free-item .ci-free-name');
    if (first) first.focus();
  }
}

async function saveCardItems() {
  const errEl = document.getElementById('ci-error');
  errEl.textContent = '';
  const items = [...cardItemsCart.values()].map(e => ({
    code: e.code || '', name: e.name || '', quantity: e.qty, unit_price: Number(e.price) || 0
  }));
  try {
    const r = await api(`/collections/cards/${addItemsCardId}/items`, { method: 'POST', body: { items } });
    toast(r.message);
    closeModal();
    loadCollections();
    openCardDetail(addItemsCardId);
  } catch (err) { errEl.textContent = err.message; }
}

async function voidCard(id) {
  if (!confirm('¿Anular esta tarjeta? Debe estar pendiente para poder anularla.')) return;
  try { const r = await api(`/collections/cards/${id}/void`, { method: 'POST' }); toast(r.message); closeModal(); loadCollections(); }
  catch (err) { toast(err.message, 'error'); }
}

async function reactivateCard(id) {
  if (!confirm('¿Reactivar esta tarjeta? Volverá a estado pendiente.')) return;
  try { const r = await api(`/collections/cards/${id}/reactivate`, { method: 'POST' }); toast(r.message); closeModal(); loadCollections(); }
  catch (err) { toast(err.message, 'error'); }
}

async function deleteCard(id, name) {
  if (!confirm(`¿Eliminar definitivamente la tarjeta de "${name}" junto con su historial de abonos?`)) return;
  try { const r = await api('/collections/cards/' + id, { method: 'DELETE' }); toast(r.message); closeModal(); loadCollections(); }
  catch (err) { toast(err.message, 'error'); }
}

async function printManualCard(id) {
  try {
    const c = await api('/collections/cards/' + id);
    await loadStoreSettings();
    const s = storeSettings;
    const area = document.getElementById('print-area');
    const balance = c.amount - c.paid_amount;

    area.innerHTML = `
      <div class="invoice-sheet">
        <header class="inv-head">
          <div class="inv-store">
            <h1>${esc(s.store_name)}</h1>
            ${s.phone ? `<p><strong>Tel:</strong> ${esc(s.phone)}</p>` : ''}
            ${s.address ? `<p>${esc(s.address)}</p>` : ''}
          </div>
          <div class="inv-title">
            <h2>TARJETA DE COBRO</h2>
            <p><strong>Impresa:</strong> ${localDateStr(new Date())}</p>
          </div>
        </header>

        <div class="inv-sep"></div>

        <div class="inv-meta">
          <div>
            <p><strong>Cliente:</strong> ${esc(c.customer_name)}</p>
            <p><strong>Teléfono:</strong> ${esc(c.phone || '—')}</p>
            <p><strong>Dirección:</strong> ${esc([c.address, c.city].filter(Boolean).join(', ') || '—')}</p>
          </div>
          <div>
            <p><strong>Fecha del fiado:</strong> ${c.fiado_date}</p>
            <p><strong>Forma de pago:</strong> ${PAY_TYPE_LABELS[c.payment_type]}</p>
            ${c.schedule ? `<p><strong>Próximo cobro:</strong> #${c.schedule.next_due_number} — ${fmtDue(c.schedule.next_due_date)}</p>` : ''}
          </div>
        </div>

        ${c.items.length ? `
        <table class="inv-items">
          <thead><tr><th class="c-item">#</th><th>Código</th><th>Artículo</th><th class="t-right">Cant.</th><th class="t-right">Vr. unitario</th><th class="t-right">Total</th></tr></thead>
          <tbody>
            ${c.items.map((it, i) => `
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
            <tr><td colspan="5" class="t-right"><strong>Total fiado</strong></td><td class="t-right inv-total-cell"><strong>${money(c.amount)}</strong></td></tr>
            <tr><td colspan="5" class="t-right"><strong>Abonado</strong></td><td class="t-right"><strong>${money(c.paid_amount)}</strong></td></tr>
            <tr><td colspan="5" class="t-right"><strong>SALDO PENDIENTE</strong></td><td class="t-right inv-total-cell"><strong>${money(balance)}</strong></td></tr>
          </tfoot>
        </table>`
        : `
        <table class="inv-items">
          <thead><tr><th>Código</th><th>Artículo</th><th class="t-right">Valor</th><th class="t-right">Abonado</th><th class="t-right">Saldo</th></tr></thead>
          <tbody>
            <tr>
              <td>${esc(c.item_code || '—')}</td>
              <td>${esc(c.item_name || '—')}</td>
              <td class="t-right">${money(c.amount)}</td>
              <td class="t-right">${money(c.paid_amount)}</td>
              <td class="t-right"><strong>${money(balance)}</strong></td>
            </tr>
          </tbody>
        </table>`}

        ${c.notes ? `<p class="inv-notes"><strong>Notas:</strong> ${esc(c.notes)}</p>` : ''}

        ${c.payments.length ? `
          <p class="inv-notes"><strong>Abonos registrados:</strong></p>
          <table class="inv-items">
            <tbody>
              ${c.payments.map(p => `
                <tr><td>${fmtDue(p.payment_date || fmtDate(p.created_at).slice(0, 10))}</td><td>${esc(p.method)}</td><td class="t-right">${money(p.amount)}</td></tr>`).join('')}
            </tbody>
          </table>` : ''}

        <div class="inv-signatures">
          <div class="sig"><span></span><small>Deudor: ${esc(c.customer_name)}</small></div>
          <div class="sig"><span></span><small>Cobrador</small></div>
        </div>

        ${s.invoice_footer ? `<footer class="inv-footer">${esc(s.invoice_footer)}</footer>` : ''}
      </div>`;

    window.print();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- Fiados automáticos (de facturas) ---------- */
function renderCustomerCards(cards) {
  const box = document.getElementById('customer-cards-grid');
  box.innerHTML = cards.length ? cards.map(c => `
    <div class="debt-card auto">
      <div class="debt-info">
        <div class="debt-card-top">
          <span class="avatar">${esc(c.name.trim().charAt(0).toUpperCase())}</span>
          <div class="debt-card-id">
            <h4 title="${esc(c.name)}">${esc(c.name)}</h4>
            <small>${esc(c.phone || 'Sin teléfono')}</small>
          </div>
        </div>
      </div>
      <div class="debt-money">
        <span class="debt-amount">${money(c.debt_total)}</span>
        <small>${c.pending_count} factura${c.pending_count === 1 ? '' : 's'} fiada${c.pending_count === 1 ? '' : 's'}${c.oldest_date ? ' · desde ' + c.oldest_date : ''}</small>
        ${c.oldest_days >= 90 ? `<span class="badge out" title="Su factura más vieja es del ${c.oldest_date}">🔴 Moroso: ${c.oldest_days} días sin pagar</span>` : ''}
      </div>
      <button class="btn btn-primary" onclick="openCollectionCard(${c.id})">🧾 Ver tarjeta de cobro</button>
    </div>`).join('')
    : '<p class="pos-empty" style="grid-column:1/-1;padding:3rem 0">🎉 No hay fiados de facturas pendientes. ¡Todo al día!</p>';
}

async function openCollectionCard(customerId) {
  try {
    const d = await api('/collections/customers/' + customerId);
    const c = d.customer;

    openModal('Tarjeta de cobro — ' + c.name, `
      <div class="collect-info">
        <div>
          <strong>${esc(c.name)}</strong><br>
          <small>${esc(c.phone || 'Sin teléfono')}</small>
        </div>
        <div class="collect-debt">
          <small>Debe en total</small>
          <strong>${money(d.debt_total)}</strong>
        </div>
      </div>

      ${d.invoices.length ? `
        <table class="mini-table">
          <thead><tr><th>Factura</th><th>Fecha</th><th>La hizo</th><th>Total</th><th>Saldo</th><th></th></tr></thead>
          <tbody>
            ${d.invoices.map(i => `
              <tr>
                <td><strong>FV-${String(i.number).padStart(6, '0')}</strong></td>
                <td>${fmtDate(i.created_at).slice(0, 10)}</td>
                <td>${esc(i.seller_name || i.user_name || '—')}</td>
                <td>${money(i.total)}</td>
                <td class="negative">${money(i.balance)}</td>
                <td><button class="btn btn-outline btn-small" onclick="payFullInvoice(${c.id}, ${i.id}, ${i.balance})">Saldar</button></td>
              </tr>`).join('')}
          </tbody>
        </table>`
        : '<p class="pos-empty">Este cliente no tiene fiados pendientes ✅</p>'}

      ${d.payments.length ? `
        <h4 class="collect-sub">Últimos pagos registrados</h4>
        <ul class="pay-history">
          ${d.payments.slice(0, 5).map(p => {
            const day = fmtDate(p.created_at).slice(0, 10);
            const when = p.payment_date || day;
            const extra = p.payment_date && p.payment_date !== day ? ` · anotado ${fmtDue(day)}` : '';
            return `
            <li>
              <strong class="positive">${money(p.amount)}</strong> · ${esc(p.method)}<br>
              <small>${fmtDue(when)}${extra} · 👤 Cobró: ${esc(p.user_name || '—')}${p.notes ? ' · ' + esc(p.notes) : ''}</small>
            </li>`; }).join('')}
        </ul>` : ''}

      ${d.invoices.length ? `
      <form id="payment-form">
        <div class="form-grid">
          <div><label>Monto del abono *</label><input name="amount" type="number" step="any" min="1" max="${d.debt_total}" required placeholder="Máximo ${Math.round(d.debt_total)}"></div>
          <div><label>Forma de pago</label>
            <select name="method">
              <option value="efectivo">💵 Efectivo</option>
              <option value="transferencia">🏦 Transferencia</option>
              <option value="otro">📝 Otro</option>
            </select></div>
          <div><label>Fecha del cobro *</label><input name="payment_date" type="date" value="${localDateStr(new Date())}" max="${localDateStr(new Date())}" required></div>
          <div class="full"><label>Observación</label><input name="notes" maxlength="120" placeholder="Ej: abona parte, queda debiendo..."></div>
          <p class="form-error"></p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="printCustomerCard(${c.id})">🖨 Imprimir tarjeta</button>
          <button class="btn btn-primary">💵 Registrar abono</button>
        </div>
      </form>`
      : `<div class="form-actions"><button type="button" class="btn btn-outline" onclick="printCustomerCard(${c.id})">🖨 Imprimir tarjeta</button></div>`}
    `, { wide: true });

    const form = document.getElementById('payment-form');
    if (form) form.addEventListener('submit', ev => {
      ev.preventDefault();
      registerCollectionPayment(c.id, new FormData(ev.target), ev.target);
    });
  } catch (err) { toast(err.message, 'error'); }
}

async function registerCollectionPayment(customerId, formData, form) {
  try {
    await api(`/collections/customers/${customerId}/payments`, {
      method: 'POST',
      body: Object.fromEntries(formData)
    });
    toast('Abono registrado');
    loadCollections();
    openCollectionCard(customerId);
  } catch (err) { form.querySelector('.form-error').textContent = err.message; }
}

async function payFullInvoice(customerId, invoiceId, balance) {
  if (!confirm('¿Registrar el pago completo de esta factura?')) return;
  try {
    await api(`/collections/customers/${customerId}/payments`, {
      method: 'POST',
      body: { amount: balance, invoice_id: invoiceId, method: 'efectivo', notes: 'Pago total de factura' }
    });
    toast('Factura saldada');
    loadCollections();
    openCollectionCard(customerId);
  } catch (err) { toast(err.message, 'error'); }
}

async function printCustomerCard(customerId) {
  try {
    const d = await api('/collections/customers/' + customerId);
    await loadStoreSettings();
    const s = storeSettings;
    const c = d.customer;
    const area = document.getElementById('print-area');

    area.innerHTML = `
      <div class="invoice-sheet">
        <header class="inv-head">
          <div class="inv-store">
            <h1>${esc(s.store_name)}</h1>
            ${s.phone ? `<p><strong>Tel:</strong> ${esc(s.phone)}</p>` : ''}
            ${s.address ? `<p>${esc(s.address)}</p>` : ''}
          </div>
          <div class="inv-title">
            <h2>TARJETA DE COBRO</h2>
            <p><strong>Fecha:</strong> ${localDateStr(new Date())}</p>
          </div>
        </header>

        <div class="inv-sep"></div>

        <div class="inv-meta">
          <div>
            <p><strong>Cliente:</strong> ${esc(c.name)}</p>
            <p><strong>Teléfono:</strong> ${esc(c.phone || '—')}</p>
          </div>
        </div>

        ${d.invoices.length ? `
        <table class="inv-items">
          <thead>
            <tr><th class="c-item">#</th><th>Factura</th><th>Fecha</th><th class="t-right">Total</th><th class="t-right">Abonado</th><th class="t-right">Saldo</th></tr>
          </thead>
          <tbody>
            ${d.invoices.map((i, ix) => `
              <tr>
                <td class="c-item">${ix + 1}</td>
                <td>FV-${String(i.number).padStart(6, '0')}</td>
                <td>${fmtDate(i.created_at).slice(0, 10)}</td>
                <td class="t-right">${money(i.total)}</td>
                <td class="t-right">${money(i.paid_amount)}</td>
                <td class="t-right"><strong>${money(i.balance)}</strong></td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5" class="t-right"><strong>TOTAL ADEUDADO</strong></td>
              <td class="t-right inv-total-cell"><strong>${money(d.debt_total)}</strong></td>
            </tr>
          </tfoot>
        </table>`
        : '<p class="inv-alert">No registra deudas pendientes.</p>'}

        ${d.payments.length ? `
          <p class="inv-notes"><strong>Abonos registrados:</strong></p>
          <table class="inv-items">
            <tbody>
              ${d.payments.slice(0, 8).map(p => `
                <tr>
                  <td>${fmtDue(p.payment_date || fmtDate(p.created_at).slice(0, 10))}</td>
                  <td>${esc(p.method)}</td>
                  <td class="t-right">${money(p.amount)}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : ''}

        <div class="inv-signatures">
          <div class="sig"><span></span><small>Deudor: ${esc(c.name)}</small></div>
          <div class="sig"><span></span><small>Cobrador</small></div>
        </div>

        ${s.invoice_footer ? `<footer class="inv-footer">${esc(s.invoice_footer)}</footer>` : ''}
      </div>`;

    window.print();
  } catch (err) { toast(err.message, 'error'); }
}
