/* ================= ESTUDIO CREDITICIO — MÓDULO INDEPENDIENTE ================= */

(function () {
  'use strict';

  let currentTab = 'blacklist';

  /* ---- Inicialización ---- */
  function initCreditView() {
    currentTab = 'blacklist';
    renderCreditTabs();
    loadCreditView();
  }

  function renderCreditTabs() {
    const el = document.getElementById('credit-tabs');
    if (!el) return;
    el.innerHTML = `
      <button class="credit-tab-btn active" data-credit-tab="blacklist">🚫 Lista Negra</button>
      <button class="credit-tab-btn" data-credit-tab="history">🔍 Central de Riesgos</button>
      <button class="credit-tab-btn" data-credit-tab="config">⚙️ Configuración</button>
    `;
    el.querySelectorAll('.credit-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTab = btn.dataset.creditTab;
        el.querySelectorAll('.credit-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.creditTab === currentTab));
        document.querySelectorAll('.credit-panel').forEach(p => p.classList.toggle('active', p.id === 'credit-panel-' + currentTab));
        if (currentTab === 'blacklist') loadBlacklist();
        if (currentTab === 'config') loadCreditConfig();
      });
    });
  }

  function loadCreditView() {
    if (currentTab === 'blacklist') loadBlacklist();
    if (currentTab === 'config') loadCreditConfig();
  }

  /* ============ LISTA NEGRA ============ */
  async function loadBlacklist() {
    try {
      const blocked = await api('/credit/blacklist');
      renderBlacklist(blocked);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderBlacklist(blocked) {
    const box = document.getElementById('credit-blacklist-content');
    if (!box) return;

    const stats = `
      <div class="credit-stats">
        <div class="credit-stat-card">
          <span class="stat-icon">🚫</span>
          <h3>${blocked.length}</h3>
          <p>Clientes bloqueados</p>
        </div>
        <div class="credit-stat-card">
          <span class="stat-icon">🤖</span>
          <h3>${blocked.filter(b => b.auto_blocked).length}</h3>
          <p>Bloqueados automáticamente</p>
        </div>
        <div class="credit-stat-card">
          <span class="stat-icon">✋</span>
          <h3>${blocked.filter(b => !b.auto_blocked).length}</h3>
          <p>Bloqueados manualmente</p>
        </div>
      </div>`;

    const toolbar = `
      <div class="toolbar">
        <input type="search" id="credit-search" placeholder="Buscar por nombre o teléfono..." oninput="creditDebouncedSearch()">
        <button class="btn btn-primary" onclick="openCreditBlockModal()">🚫 Bloquear cliente</button>
      </div>`;

    const list = blocked.length
      ? blocked.map(b => `
        <div class="blocked-card ${b.auto_blocked ? 'auto' : ''}">
          <div class="blocked-info">
            <h4>${esc(b.customer_name)}</h4>
            <small>${esc(b.phone || 'Sin teléfono')}</small>
          </div>
          <div class="blocked-meta">
            <small><strong>Motivo:</strong> ${esc(b.reason || 'Sin especificar')}</small>
            <small><strong>Bloqueado:</strong> ${fmtDate(b.blocked_at)}</small>
            <small><strong>Por:</strong> ${esc(b.blocked_by_name || 'Sistema')}</small>
            ${b.auto_blocked ? '<small><span class="badge low">🤖 Automático</span></small>' : '<small><span class="badge role-admin">✋ Manual</span></small>'}
          </div>
          <div class="blocked-actions">
            <button class="btn btn-green btn-small" onclick="unblockCredit(${b.id}, '${esc(b.customer_name).replace(/'/g, "\\'")}')">✅ Desbloquear</button>
          </div>
        </div>`).join('')
      : '<p class="pos-empty" style="padding:2rem 0">No hay clientes bloqueados. ¡La lista negra está vacía!</p>';

    box.innerHTML = stats + toolbar + list;
  }

  let creditSearchTimer;
  window.creditDebouncedSearch = function () {
    clearTimeout(creditSearchTimer);
    creditSearchTimer = setTimeout(async () => {
      try {
        const search = document.getElementById('credit-search')?.value.trim() || '';
        const params = search ? '?search=' + encodeURIComponent(search) : '';
        const blocked = await api('/credit/blacklist' + params);
        renderBlacklist(blocked);
      } catch (err) { toast(err.message, 'error'); }
    }, 300);
  };

  window.openCreditBlockModal = function () {
    openModal('🚫 Bloquear cliente', `
      <form id="credit-block-form">
        <div class="form-grid">
          <div class="full"><label>Nombre del cliente *</label><input name="customer_name" required maxlength="80" placeholder="Nombre completo"></div>
          <div><label>Teléfono</label><input name="phone" maxlength="40" placeholder="Opcional"></div>
          <div><label>Motivo</label><input name="reason" maxlength="200" placeholder="Ej: Deuda vencida, mal historial..."></div>
          <div class="full"><label>Notas</label><input name="notes" maxlength="200" placeholder="Observaciones adicionales"></div>
          <p class="form-error"></p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-danger">🚫 Bloquear</button>
        </div>
      </form>`);

    document.getElementById('credit-block-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = ev.target;
      try {
        const r = await api('/credit/blacklist', {
          method: 'POST',
          body: Object.fromEntries(new FormData(f))
        });
        closeModal();
        toast(r.message);
        loadBlacklist();
      } catch (err) {
        f.querySelector('.form-error').textContent = err.message;
      }
    });
  };

  window.unblockCredit = async function (id, name) {
    if (!confirm(`¿Desbloquear a "${name}"? Podrá volver a fiarse.`)) return;
    try {
      const r = await api('/credit/blacklist/' + id, { method: 'DELETE' });
      toast(r.message);
      loadBlacklist();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /* ============ HISTORIAL DE CRÉDITO ============ */
  window.searchCreditHistory = async function () {
    const name = document.getElementById('credit-history-search')?.value.trim();
    if (!name) return toast('Escribe el nombre de un cliente', 'error');

    try {
      const history = await api('/credit/history/' + encodeURIComponent(name));
      renderCreditHistory(history);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  function renderCreditHistory(h) {
    const box = document.getElementById('credit-history-content');
    if (!box) return;

    const scoreClass = h.score >= 80 ? 'excellent' : h.score >= 50 ? 'good' : h.score >= 25 ? 'warning' : 'bad';
    const initials = h.customer_name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const deuda = h.totals.deuda_actual;
    const totalItems = h.invoices.length + h.manual_cards.length + h.daily_fiados.length;
    const r = h.risk;

    const riskColors = { alto: '#ef4444', medio: '#f59e0b', bajo: '#22c55e' };
    const riskLabels = { alto: 'ALTO', medio: 'MEDIO', bajo: 'BAJO' };
    const riskIcons = { alto: '🔴', medio: '🟡', bajo: '🟢' };
    const decisionLabels = { aprobado: 'APROBADO', revision: 'EN REVISIÓN', denegado: 'DENEGADO' };
    const decisionColors = { aprobado: 'var(--green)', revision: 'var(--amber)', denegado: 'var(--red)' };

    let html = `
      <div class="risk-center">
        <div class="risk-header">
          <div class="risk-header-top">
            <div class="risk-avatar">${initials}</div>
            <div class="risk-header-info">
              <h2>${esc(h.customer_name)}</h2>
              <p class="risk-subtitle">Central de Riesgos Crediticios</p>
            </div>
            <div class="risk-decision-badge" style="background:${decisionColors[r.decision]}">
              <span class="risk-decision-icon">${r.decision === 'aprobado' ? '✅' : r.decision === 'revision' ? '🔍' : '🚫'}</span>
              <span>${decisionLabels[r.decision]}</span>
            </div>
          </div>
        </div>

        <div class="risk-body">
          <div class="risk-score-section">
            <div class="risk-gauge">
              <div class="risk-gauge-ring">
                <svg viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="#e5e7eb" stroke-width="10"/>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="${riskColors[r.level]}" stroke-width="10"
                    stroke-dasharray="${327}" stroke-dashoffset="${327 - (327 * h.score / 100)}"
                    stroke-linecap="round" transform="rotate(-90 60 60)" class="risk-gauge-arc"/>
                </svg>
                <div class="risk-gauge-center">
                  <span class="risk-gauge-score">${h.score}</span>
                  <span class="risk-gauge-label">SCORE</span>
                </div>
              </div>
            </div>
            <div class="risk-level-info">
              <div class="risk-level-badge" style="background:${riskColors[r.level]}20;color:${riskColors[r.level]};border:2px solid ${riskColors[r.level]}">
                ${riskIcons[r.level]} Nivel de Riesgo: <strong>${riskLabels[r.level]}</strong>
              </div>
              <p class="risk-summary">${esc(r.summary)}</p>
            </div>
          </div>

          <div class="risk-factors">
            <h4 class="risk-factors-title">Factores de Evaluación</h4>
            <div class="risk-factors-list">
              ${r.factors.length ? r.factors.map(f => `
                <div class="risk-factor risk-factor-${f.type}">
                  <span class="rf-icon">${f.icon}</span>
                  <span class="rf-label">${esc(f.label)}</span>
                </div>`).join('') : '<p class="risk-no-data">Sin factores para evaluar</p>'}
            </div>
          </div>

          <div class="risk-kpis">
            <div class="risk-kpi">
              <span class="risk-kpi-icon">📊</span>
              <div>
                <span class="risk-kpi-value">${r.total_transactions}</span>
                <span class="risk-kpi-label">Transacciones</span>
              </div>
            </div>
            <div class="risk-kpi">
              <span class="risk-kpi-icon">⏰</span>
              <div>
                <span class="risk-kpi-value ${r.overdue_count > 0 ? 'red' : ''}">${r.overdue_count}</span>
                <span class="risk-kpi-label">Vencidas</span>
              </div>
            </div>
            <div class="risk-kpi">
              <span class="risk-kpi-icon">✅</span>
              <div>
                <span class="risk-kpi-value ${r.on_time_count > 0 ? 'green' : ''}">${r.on_time_count}</span>
                <span class="risk-kpi-label">A tiempo</span>
              </div>
            </div>
            <div class="risk-kpi">
              <span class="risk-kpi-icon">📈</span>
              <div>
                <span class="risk-kpi-value red">${money(r.max_debt)}</span>
                <span class="risk-kpi-label">Máx. deuda</span>
              </div>
            </div>
          </div>

          <div class="risk-dates">
            ${r.first_debt_date ? `<div class="risk-date-item"><span class="rdi-label">Primer crédito</span><span class="rdi-value">${fmtDate(r.first_debt_date)}</span></div>` : ''}
            ${r.last_debt_date ? `<div class="risk-date-item"><span class="rdi-label">Último crédito</span><span class="rdi-value">${fmtDate(r.last_debt_date)}</span></div>` : ''}
            ${r.last_payment_date ? `<div class="risk-date-item"><span class="rdi-label">Último pago</span><span class="rdi-value">${fmtDate(r.last_payment_date)}</span></div>` : ''}
          </div>

          ${h.blocked ? `
            <div class="risk-alert risk-alert-blocked">
              <span class="risk-alert-icon">⛔</span>
              <div>
                <strong>BLOQUEADO</strong>
                <p>${esc(h.blocked.reason || 'Sin motivo')} · Desde ${fmtDate(h.blocked.blocked_at)}</p>
              </div>
            </div>` : ''}

          ${deuda > 0 && !h.blocked ? `
            <div class="risk-alert risk-alert-warning">
              <span class="risk-alert-icon">⚠️</span>
              <div>
                <strong>DEUDA PENDIENTE</strong>
                <p>${money(deuda)} sin pagar</p>
              </div>
            </div>` : ''}
        </div>
      </div>`;

    html += `
      <div class="risk-notes-section">
        <div class="risk-section-header">
          <h4>📋 Notas y Observaciones</h4>
          <button class="btn btn-primary btn-small" onclick="openRiskNoteModal('${esc(h.customer_name).replace(/'/g, "\\'")}')">+ Agregar nota</button>
        </div>
        <div id="risk-notes-list">
          ${h.risk_notes.length ? h.risk_notes.map(n => `
            <div class="risk-note risk-note-${n.severity}">
              <div class="risk-note-header">
                <span class="risk-note-type">${n.note_type === 'warning' ? '⚠️' : n.note_type === 'block_reason' ? '🚫' : n.note_type === 'payment_issue' ? '💸' : '📝'}</span>
                <strong>${esc(n.title)}</strong>
                <small>${fmtDate(n.created_at)} · ${esc(n.author_name || 'Sistema')}</small>
              </div>
              ${n.description ? `<p class="risk-note-desc">${esc(n.description)}</p>` : ''}
            </div>`).join('') : '<p class="risk-no-data" style="padding:1rem 0">Sin notas registradas</p>'}
        </div>
      </div>`;

    if (h.invoices.length) {
      html += `
        <div class="risk-section">
          <div class="risk-section-header">
            <h4>🧾 Facturas fiadas</h4>
            <span class="risk-section-count">${h.invoices.length}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Factura</th><th>Fecha</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th></tr></thead>
              <tbody>
                ${h.invoices.map(i => {
                  const saldo = i.total - i.paid_amount;
                  return `<tr>
                    <td><strong>FV-${String(i.number).padStart(6, '0')}</strong></td>
                    <td>${fmtDate(i.created_at)}</td>
                    <td>${money(i.total)}</td>
                    <td>${money(i.paid_amount)}</td>
                    <td class="${saldo > 0 ? 'negative' : 'positive'}">${money(saldo)}</td>
                    <td><span class="badge status-${i.status}">${i.status}</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    if (h.manual_cards.length) {
      html += `
        <div class="risk-section">
          <div class="risk-section-header">
            <h4>📝 Tarjetas manuales</h4>
            <span class="risk-section-count">${h.manual_cards.length}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Artículo</th><th>Total</th><th>Abonado</th><th>Saldo</th><th>Estado</th></tr></thead>
              <tbody>
                ${h.manual_cards.map(c => {
                  const saldo = c.amount - c.paid_amount;
                  return `<tr>
                    <td>${c.fiado_date}</td>
                    <td>${esc(c.item_name || c.item_code || '—')}</td>
                    <td>${money(c.amount)}</td>
                    <td>${money(c.paid_amount)}</td>
                    <td class="${saldo > 0 ? 'negative' : 'positive'}">${money(saldo)}</td>
                    <td><span class="badge status-${c.status === 'pagada' ? 'pagada' : c.status === 'anulada' ? 'anulada' : 'pendiente'}">${c.status}</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    if (h.daily_fiados.length) {
      html += `
        <div class="risk-section">
          <div class="risk-section-header">
            <h4>⚡ Fiados del día</h4>
            <span class="risk-section-count">${h.daily_fiados.length}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Descripción</th><th>Total</th><th>Abonado</th><th>Vence</th><th>Estado</th></tr></thead>
              <tbody>
                ${h.daily_fiados.map(d => {
                  return `<tr>
                    <td>${d.fiado_date}</td>
                    <td>${esc(d.description || '—')}</td>
                    <td>${money(d.amount)}</td>
                    <td>${money(d.paid_amount)}</td>
                    <td>${fmtDue(d.due_date)}</td>
                    <td><span class="badge status-${d.status === 'pagada' ? 'pagada' : d.status === 'vencida' ? 'anulada' : 'pendiente'}">${d.status}</span></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    if (!h.invoices.length && !h.manual_cards.length && !h.daily_fiados.length) {
      html += '<p class="pos-empty" style="padding:2rem 0">No se encontró historial de crédito para este cliente.</p>';
    }

    box.innerHTML = html;
  }

  /* ============ MODAL DE NOTAS DE RIESGO ============ */
  window.openRiskNoteModal = function (customerName) {
    openModal('📋 Agregar nota de riesgo', `
      <form id="risk-note-form">
        <div class="form-grid">
          <div class="full">
            <label>Tipo de nota</label>
            <select name="note_type" required>
              <option value="observation">📝 Observación general</option>
              <option value="warning">⚠️ Advertencia</option>
              <option value="block_reason">🚫 Motivo de bloqueo</option>
              <option value="payment_issue">💸 Problema de pago</option>
            </select>
          </div>
          <div class="full">
            <label>Severidad</label>
            <select name="severity" required>
              <option value="info">ℹ️ Informativo</option>
              <option value="warning">⚠️ Advertencia</option>
              <option value="danger">🔴 Peligro</option>
            </select>
          </div>
          <div class="full">
            <label>Título *</label>
            <input name="title" required maxlength="120" placeholder="Ej: Cliente promete pago el viernes">
          </div>
          <div class="full">
            <label>Descripción</label>
            <textarea name="description" maxlength="500" rows="3" placeholder="Detalles adicionales..."></textarea>
          </div>
          <p class="form-error"></p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary">💾 Guardar nota</button>
        </div>
      </form>`);

    document.getElementById('risk-note-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = ev.target;
      try {
        await api('/credit/history/' + encodeURIComponent(customerName) + '/notes', {
          method: 'POST',
          body: Object.fromEntries(new FormData(f))
        });
        closeModal();
        toast('Nota agregada');
        searchCreditHistory();
      } catch (err) {
        f.querySelector('.form-error').textContent = err.message;
      }
    });
  };

  /* ============ CONFIGURACIÓN ============ */
  async function loadCreditConfig() {
    try {
      const cfg = await api('/credit/settings');
      const box = document.getElementById('credit-config-content');
      if (!box) return;
      box.innerHTML = `
        <div class="credit-config-card">
          <h4 style="margin-bottom:1rem">Configuración de bloqueo automático</h4>
          <p class="config-hint">Los clientes se bloquean automáticamente cuando acumulan más de los días indicados sin pagar ninguna deuda (facturas fiadas, tarjetas manuales o fiados del día).</p>
          <form id="credit-config-form">
            <div class="form-grid">
              <div>
                <label>Días de mora para bloqueo automático</label>
                <input type="number" name="credit_block_days" min="1" max="365" value="${cfg.credit_block_days || 90}">
              </div>
              <p class="form-error"></p>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-outline" onclick="runAutoBlock()">🤖 Ejecutar bloqueo automático ahora</button>
              <button type="submit" class="btn btn-primary">💾 Guardar</button>
            </div>
          </form>
        </div>`;

      document.getElementById('credit-config-form').addEventListener('submit', async ev => {
        ev.preventDefault();
        const f = ev.target;
        try {
          const r = await api('/credit/settings', {
            method: 'PUT',
            body: { credit_block_days: f.credit_block_days.value }
          });
          toast(r.message);
        } catch (err) {
          f.querySelector('.form-error').textContent = err.message;
        }
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  window.runAutoBlock = async function () {
    if (!confirm('¿Ejecutar el bloqueo automático ahora? Se bloquearán los clientes con deudas vencidas.')) return;
    try {
      const r = await api('/credit/auto-block', { method: 'POST' });
      toast(r.message);
      if (r.blocked_count > 0) loadBlacklist();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /* ============ VERIFICACIÓN PARA EL POS ============ */
  async function checkPosBlocked(customerName) {
    if (!customerName || !customerName.trim()) return null;
    try {
      const r = await api('/credit/check/' + encodeURIComponent(customerName.trim()));
      return r.blocked ? r.info : null;
    } catch {
      return null;
    }
  }

  function showBlockedModal(info, onSuccess) {
    openModal('🚫 Cliente bloqueado', `
      <div class="credit-block-modal">
        <div class="block-icon">⛔</div>
        <h3>Este cliente está bloqueado</h3>
        <p class="block-reason">
          <strong>${esc(info.customer_name)}</strong><br>
          Motivo: ${esc(info.reason || 'Sin especificar')}<br>
          Bloqueado el: ${fmtDate(info.blocked_at)}
        </p>
        <div class="block-actions">
          <button class="btn btn-outline" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-green" id="credit-unblock-and-continue">🔓 Desbloquear y continuar</button>
        </div>
      </div>`);

    document.getElementById('credit-unblock-and-continue').addEventListener('click', async () => {
      try {
        await api('/credit/blacklist/' + info.id, { method: 'DELETE' });
        closeModal();
        toast('Cliente desbloqueado');
        if (onSuccess) onSuccess();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  /* ============ EXPONER FUNCIONES GLOBALES ============ */
  window.initCreditView = initCreditView;
  window.loadBlacklist = loadBlacklist;
  window.searchCreditHistory = searchCreditHistory;
  window.checkPosBlocked = checkPosBlocked;
  window.showBlockedModal = showBlockedModal;

})();
