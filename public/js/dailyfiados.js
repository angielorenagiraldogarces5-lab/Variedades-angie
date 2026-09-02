/* ================= FIADOS DEL DÍA ================= */
let dfTimer;
function debouncedLoadDailyFiados() { clearTimeout(dfTimer); dfTimer = setTimeout(loadDailyFiados, 300); }

const PLAZO_LABELS = { diario: 'Diario', '8dias': '8 días', semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };

async function loadDailyFiados() {
  try {
    const params = new URLSearchParams();
    const s = document.getElementById('df-search')?.value.trim();
    if (s) params.set('search', s);
    const st = document.getElementById('df-status-filter')?.value;
    if (st) params.set('status', st);

    const data = await api('/daily-fiados?' + params.toString());
    const st2 = data.stats;

    document.getElementById('daily-fiados-stats').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card" style="border-left:4px solid #ef4444">
          <span class="stat-icon">🔴</span>
          <h3>${st2.vencidos}</h3>
          <p>Vencidos · ${money(st2.vencidos_monto)}</p>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b">
          <span class="stat-icon">🟡</span>
          <h3>${st2.vence_hoy}</h3>
          <p>Vencen hoy · ${money(st2.vence_hoy_monto)}</p>
        </div>
        <div class="stat-card" style="border-left:4px solid #3b82f6">
          <span class="stat-icon">📋</span>
          <h3>${st2.pendientes}</h3>
          <p>Pendientes · ${money(st2.pendientes_monto)}</p>
        </div>
        <div class="stat-card" style="border-left:4px solid #22c55e">
          <span class="stat-icon">💰</span>
          <h3>${money(st2.cobrado_mes)}</h3>
          <p>Cobrado este mes</p>
        </div>
      </div>`;

    const todayStr = isoDate(new Date());
    document.getElementById('daily-fiados-table').innerHTML = `
      <thead><tr>
        <th>Cliente</th><th>Descripción</th><th>Monto</th><th>Plazo</th>
        <th>Fecha</th><th>Vence</th><th>Saldo</th><th>Estado</th><th>Acciones</th>
      </tr></thead>
      <tbody>
        ${data.fiados.length ? data.fiados.map(f => {
          const isOverdue = f.status === 'vencida';
          const isDueToday = f.status === 'pendiente' && f.due_date === todayStr;
          const isBlocked = f.is_blocked;
          const rowClass = isBlocked ? 'style="background:#fef2f2;border-left:3px solid #dc2626"' : isOverdue ? 'style="background:#fef2f2;border-left:3px solid #ef4444"' : isDueToday ? 'style="background:#fefce8;border-left:3px solid #f59e0b"' : '';
          return `<tr ${rowClass}>
            <td><strong>${esc(f.customer_name)}</strong>${f.phone ? `<br><small style="color:var(--muted)">${esc(f.phone)}</small>` : ''}${f.is_blocked ? '<br><span class="badge" style="background:#dc2626;color:#fff;font-size:11px">🚫 BLOQUEADO</span>' : ''}</td>
            <td>${esc(f.description)}</td>
            <td><strong>${money(f.amount)}</strong></td>
            <td><span class="badge" style="background:#dbeafe;color:#1d4ed8">${PLAZO_LABELS[f.payment_type] || f.payment_type}</span></td>
            <td>${f.fiado_date}</td>
            <td>${f.due_date}</td>
            <td><strong>${money(f.balance)}</strong></td>
            <td>${f.status === 'pagada' ? '<span class="badge ok">✅ Pagado</span>'
              : isOverdue ? '<span class="badge out">🔴 Vencido</span>'
              : '<span class="badge low">⏳ Pendiente</span>'}</td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick="viewDailyFiado(${f.id})">👁 Ver</button>
              ${f.status !== 'pagada' ? `<button class="btn btn-primary btn-small" onclick="openDailyFiadoPaymentModal(${f.id})">💰 Abonar</button>` : ''}
              ${currentUser.role === 'admin' && f.status !== 'pagada' ? `<button class="btn btn-outline btn-small" onclick="markDailyFiadoPaid(${f.id})">✅ Pagado</button>` : ''}
              ${currentUser.role === 'admin' ? `<button class="btn btn-danger btn-small" onclick="deleteDailyFiado(${f.id})">🗑</button>` : ''}
            </div></td>
          </tr>`;
        }).join('')
          : '<tr class="empty-row"><td colspan="9">No hay fiados registrados. ¡Crea el primero!</td></tr>'}
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openDailyFiadoModal(skipStudy = false, prefilledName = '') {
  if (!skipStudy) {
    return openCreditStudyBeforeFiado((name) => openDailyFiadoModal(true, name));
  }
  const today = isoDate(new Date());
  openModal('Nuevo Fiado del Día', `
    <form id="daily-fiado-form">
      <div class="form-grid">
        <div><label>Fecha del fiado *</label><input type="date" name="fiado_date" value="${today}" required></div>
        <div><label>Plazo de pago *</label>
          <select name="payment_type" required>
            <option value="diario">Diario (1 día)</option>
            <option value="8dias">8 días</option>
            <option value="semanal">Semanal</option>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
        </div>
        <div class="full"><label>Nombre del cliente *</label><input name="customer_name" required placeholder="Ej: Juan Pérez" value="${esc(prefilledName || '')}"></div>
        <div><label>Teléfono</label><input name="phone" placeholder="Opcional"></div>
        <div><label>Monto total *</label><input type="number" name="amount" min="1" step="1" required placeholder="0"></div>
        <div class="full"><label>Descripción *</label><input name="description" required placeholder="Ej: 2 pañales + detergente"></div>
        <div class="full"><label>Observaciones</label><input name="notes" placeholder="Nota rápida..."></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Crear Fiado</button>
      </div>
    </form>`);

  document.getElementById('daily-fiado-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('/daily-fiados', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal(); toast('Fiado creado'); loadDailyFiados();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function viewDailyFiado(id) {
  try {
    const f = await api('/daily-fiados/' + id);
    const isOverdue = f.status === 'vencida';

    let creditInfo = '';
    try {
      const cr = await api('/daily-fiados/credit-check/' + encodeURIComponent(f.customer_name));
      const riskIcons = { bajo: '🟢', medio: '🟡', alto: '🔴' };
      creditInfo = `
        <div style="margin:12px 0;padding:12px;border-radius:8px;background:${cr.blocked ? '#fef2f2' : '#f0fdf4'};border:1px solid ${cr.blocked ? '#fca5a5' : '#bbf7d0'}">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="font-size:13px">📊 Crédito:</strong>
            ${cr.blocked ? '<span class="badge" style="background:#dc2626;color:#fff">🚫 BLOQUEADO</span>' : '<span class="badge ok">✅ Activo</span>'}
            ${cr.score !== null ? `<span class="badge">Score: ${cr.score}%</span>` : ''}
            ${cr.risk_level ? `<span class="badge">${riskIcons[cr.risk_level] || ''} Riesgo ${cr.risk_level.toUpperCase()}</span>` : ''}
            ${cr.deuda_actual > 0 ? `<span class="badge out">Deuda: ${money(cr.deuda_actual)}</span>` : ''}
            ${cr.overdue_count > 0 ? `<span class="badge out">${cr.overdue_count} vencida(s)</span>` : ''}
          </div>
          ${cr.blocked ? `<p style="margin:6px 0 0;font-size:12px;color:#b91c1c">Motivo: ${esc(cr.blocked_info?.reason || 'Sin motivo')} — Desbloquear desde Estudio Crediticio</p>` : ''}
        </div>`;
    } catch {}

    openModal(`Fiado #${f.id}`, `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div><small style="color:var(--muted)">Cliente</small><br><strong>${esc(f.customer_name)}</strong></div>
        <div><small style="color:var(--muted)">Teléfono</small><br>${esc(f.phone || '—')}</div>
        <div><small style="color:var(--muted)">Descripción</small><br>${esc(f.description)}</div>
        <div><small style="color:var(--muted)">Plazo</small><br>${PLAZO_LABELS[f.payment_type]}</div>
        <div><small style="color:var(--muted)">Monto total</small><br><strong>${money(f.amount)}</strong></div>
        <div><small style="color:var(--muted)">Abonado</small><br><strong style="color:var(--positive)">${money(f.paid_amount)}</strong></div>
        <div><small style="color:var(--muted)">Saldo</small><br><strong style="color:var(--danger)">${money(f.balance)}</strong></div>
        <div><small style="color:var(--muted)">Estado</small><br>${f.status === 'pagada' ? '✅ Pagado' : isOverdue ? '🔴 Vencido' : '⏳ Pendiente'}</div>
        <div><small style="color:var(--muted)">Fecha fiado</small><br>${f.fiado_date}</div>
        <div><small style="color:var(--muted)">Vence</small><br>${f.due_date}</div>
      </div>
      ${creditInfo}
      ${f.notes ? `<p><small style="color:var(--muted)">Notas:</small> ${esc(f.notes)}</p>` : ''}
      <h4 style="margin:16px 0 8px">Historial de abonos</h4>
      ${f.payments.length ? `<table style="width:100%;font-size:13px"><thead><tr><th>Fecha</th><th style="text-align:right">Monto</th><th>Método</th></tr></thead><tbody>
        ${f.payments.map(p => `<tr><td>${p.payment_date || p.created_at?.slice(0,10)}</td><td style="text-align:right;color:var(--positive);font-weight:bold">${money(p.amount)}</td><td>${p.method}</td></tr>`).join('')}
      </tbody></table>` : '<p style="color:var(--muted)">Sin abonos registrados</p>'}
      ${f.status !== 'pagada' ? `<div style="margin-top:12px"><a href="https://wa.me/?text=Hola ${esc(f.customer_name)}, te recordamos que tienes un fiado pendiente de ${money(f.balance)} que vence el ${f.due_date}. ¡Gracias!" target="_blank" class="btn btn-outline" style="color:#25d366;border-color:#25d366">📱 WhatsApp recordatorio</a></div>` : ''}
    `, { wide: true });
  } catch (err) { toast(err.message, 'error'); }
}

function openDailyFiadoPaymentModal(id) {
  const today = isoDate(new Date());
  openModal('Registrar abono', `
    <form id="df-payment-form">
      <div class="form-grid">
        <div><label>Fecha del abono</label><input type="date" name="payment_date" value="${today}"></div>
        <div><label>Monto *</label><input type="number" name="amount" min="1" step="1" required placeholder="0"></div>
        <div><label>Método</label>
          <select name="method">
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div class="full"><label>Notas</label><input name="notes" placeholder="Opcional"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Registrar abono</button>
      </div>
    </form>`);

  document.getElementById('df-payment-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api('/daily-fiados/' + id + '/payments', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal(); toast(r.message); loadDailyFiados();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function markDailyFiadoPaid(id) {
  if (!confirm('¿Marcar como pagado?')) return;
  try { const r = await api('/daily-fiados/' + id + '/mark-paid', { method: 'POST' }); toast(r.message); loadDailyFiados(); }
  catch (err) { toast(err.message, 'error'); }
}

async function deleteDailyFiado(id) {
  if (!confirm('¿Eliminar este fiado?')) return;
  try { await api('/daily-fiados/' + id, { method: 'DELETE' }); toast('Fiado eliminado'); loadDailyFiados(); }
  catch (err) { toast(err.message, 'error'); }
}
