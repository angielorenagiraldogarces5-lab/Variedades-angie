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
      <button class="credit-tab-btn" data-credit-tab="history">🔍 Historial de Crédito</button>
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

    let html = `
      <div class="credit-history-header">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <h3>📋 Historial de ${esc(h.customer_name)}</h3>
          ${h.blocked
            ? '<span class="badge out">🚫 BLOQUEADO</span>'
            : '<span class="badge ok">✅ ACTIVO</span>'}
        </div>
        <div class="credit-history-grid" style="margin-top:.8rem">
          <div class="ch-item"><small>Total fiado</small><strong style="color:var(--red)">${money(h.totals.total_fiado)}</strong></div>
          <div class="ch-item"><small>Total pagado</small><strong style="color:var(--green)">${money(h.totals.total_pagado)}</strong></div>
          <div class="ch-item"><small>Deuda actual</small><strong style="color:${h.totals.deuda_actual > 0 ? 'var(--red)' : 'var(--green)'}">${money(h.totals.deuda_actual)}</strong></div>
          <div class="ch-item"><small>Confiabilidad</small><span class="score-badge ${scoreClass}">${h.score}%</span></div>
        </div>
        ${h.blocked ? `
          <div style="margin-top:.6rem;padding:.5rem .8rem;background:#fee2e2;border-radius:8px;font-size:.88rem">
            <strong>🚫 Bloqueado:</strong> ${esc(h.blocked.reason || 'Sin motivo')} · ${fmtDate(h.blocked.blocked_at)}
          </div>` : ''}
      </div>`;

    // Facturas fiadas
    if (h.invoices.length) {
      html += `
        <div class="credit-section">
          <h4>🧾 Facturas fiadas (${h.invoices.length})</h4>
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

    // Tarjetas manuales
    if (h.manual_cards.length) {
      html += `
        <div class="credit-section">
          <h4>📝 Tarjetas manuales (${h.manual_cards.length})</h4>
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

    // Fiados del día
    if (h.daily_fiados.length) {
      html += `
        <div class="credit-section">
          <h4>⚡ Fiados del día (${h.daily_fiados.length})</h4>
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
