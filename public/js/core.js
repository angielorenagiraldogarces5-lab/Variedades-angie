/* ================= ESTADO GLOBAL ================= */
let token = localStorage.getItem('token') || null;
let currentUser = null;
let storeSettings = { store_name: 'Variedades Angie', nit: '', address: '', phone: '', commission_rate: '15', invoice_footer: '' };
const moneyFmt = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(n) { return '$' + moneyFmt.format(Math.round(Number(n) || 0)); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmtDate(d) { return d ? d.replace('T', ' ').slice(0, 16) : ''; }
function isoDate(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()); }

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(); throw new Error(data.error || 'Sesión expirada'); }
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

/* ================= TOASTS / MODAL ================= */
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

function openModal(title, bodyHtml, opts = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const dlg = document.getElementById('modal');
  dlg.classList.toggle('wide', !!opts.wide);
  if (!dlg.open) dlg.showModal();
}
function closeModal() { document.getElementById('modal').close(); }

/* ================= SESIÓN ================= */
function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('token');
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: {
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value
      }
    });
    token = data.token; currentUser = data.user;
    localStorage.setItem('token', token);
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.getElementById('btn-logout').addEventListener('click', logout);

document.getElementById('btn-change-password').addEventListener('click', () => {
  openModal('Cambiar contraseña', `
    <form id="password-form">
      <div class="form-grid">
        <div class="full"><label>Contraseña actual</label><input type="password" name="current_password" required></div>
        <div class="full"><label>Nueva contraseña (mínimo 6 caracteres)</label><input type="password" name="new_password" minlength="6" required></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  document.getElementById('password-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('/auth/password', {
        method: 'PUT',
        body: { current_password: f.current_password.value, new_password: f.new_password.value }
      });
      closeModal(); toast('Contraseña actualizada');
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
});

document.getElementById('btn-reset-other-password').addEventListener('click', async () => {
  let users;
  try { users = await api('/users/list'); } catch { return toast('Error al cargar usuarios', 'error'); }
  openModal('Restablecer contraseña de otro', `
    <form id="reset-other-form">
      <div class="form-grid">
        <div class="full"><label>Seleccionar usuario</label>
          <select name="user_id" required>
            <option value="">— Elegir colaborador —</option>
            ${users.filter(u => u.id !== currentUser.id).map(u => `<option value="${u.id}">${esc(u.full_name)} (@${esc(u.username)})</option>`).join('')}
          </select></div>
        <div class="full"><label>Nueva contraseña (mínimo 6 caracteres)</label>
          <input name="new_password" type="password" required minlength="6" autocomplete="new-password"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Restablecer</button>
      </div>
    </form>`);
  document.getElementById('reset-other-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('/users/' + f.user_id.value + '/reset-password', {
        method: 'POST',
        body: { new_password: f.new_password.value }
      });
      closeModal(); toast('Contraseña restablecida correctamente');
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
});

function enterApp() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');

  // Mostrar/ocultar funciones de administrador
  const isAdmin = currentUser.role === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    isAdmin ? el.classList.remove('hidden') : el.classList.add('hidden');
  });

  loadStoreSettings();
  switchView('dashboard');
}

/* ================= CONFIGURACIÓN DEL NEGOCIO ================= */
async function loadStoreSettings() {
  try { storeSettings = { ...storeSettings, ...(await api('/settings')) }; }
  catch { /* si falla se usan los valores por defecto */ }
}

async function loadSettings() {
  try {
    storeSettings = await api('/settings');
    const f = document.getElementById('settings-form');
    f.store_name.value = storeSettings.store_name || '';
    f.nit.value = storeSettings.nit || '';
    f.phone.value = storeSettings.phone || '';
    f.address.value = storeSettings.address || '';
    f.commission_rate.value = storeSettings.commission_rate || '15';
    f.invoice_footer.value = storeSettings.invoice_footer || '';
    f.querySelector('.form-error').textContent = '';
  } catch (err) { toast(err.message, 'error'); }
}

document.getElementById('settings-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/settings', {
      method: 'PUT',
      body: {
        store_name: f.store_name.value,
        nit: f.nit.value,
        phone: f.phone.value,
        address: f.address.value,
        commission_rate: f.commission_rate.value,
        invoice_footer: f.invoice_footer.value
      }
    });
    storeSettings = r.settings;
    toast(r.message);
  } catch (err) { f.querySelector('.form-error').textContent = err.message; }
});

/* ================= NAVEGACIÓN ================= */
document.querySelectorAll('.nav-item').forEach(btn =>
  btn.addEventListener('click', () => switchView(btn.dataset.view))
);

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));

  if (name === 'dashboard') loadDashboard();
  if (name === 'facturar') { resetPos(); loadPosProducts(); loadPosCustomers(); loadPosSellers(); }
  if (name === 'pedidos') loadOrders();
  if (name === 'facturas') loadInvoices();
  if (name === 'cobros') loadCollections();
  if (name === 'fiados_cortos') loadDailyFiados();
  if (name === 'clientes') loadCustomersTable();
  if (name === 'proveedores') loadSuppliers();
  if (name === 'caja') loadCashRegisters();
  if (name === 'contabilidad') initAccountingView();
  if (name === 'productos') { loadCategoryFilter(); loadProducts(); }
  if (name === 'movimientos') loadMovements();
  if (name === 'categorias') loadCategoriesTable();
  if (name === 'usuarios') loadUsersTable();
  if (name === 'comisiones') initCommissionsView();
  if (name === 'config') loadSettings();
  if (name === 'credit') initCreditView();
}

/* ================= DASHBOARD ================= */
async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    const t = d.totals;
    const profit = (t.inventory_sale_value || 0) - (t.inventory_cost_value || 0);

    document.getElementById('dashboard-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><span class="stat-icon">📦</span><h3>${t.total_products}</h3><p>Productos activos</p></div>
        <div class="stat-card"><span class="stat-icon">#️⃣</span><h3>${t.total_units}</h3><p>Unidades en stock</p></div>
        <div class="stat-card"><span class="stat-icon">💰</span><h3>${money(t.inventory_cost_value)}</h3><p>Valor del inventario (costo)</p></div>
        <div class="stat-card"><span class="stat-icon">📈</span><h3>${money(profit)}</h3><p>Ganancia estimada si se vende todo</p></div>
        <div class="stat-card"><span class="stat-icon">⚠️</span><h3>${t.low_stock_count || 0}</h3><p>Productos con stock bajo</p></div>
        <div class="stat-card"><span class="stat-icon">🔄</span><h3>${d.movementsToday}</h3><p>Movimientos hoy</p></div>
      </div>

      <div class="dashboard-cols">
        <div class="panel">
          <h4>⚠️ Productos con stock bajo o agotado</h4>
          ${d.lowStockProducts.length ? `<ul>${d.lowStockProducts.map(p => `
            <li><div><strong>${esc(p.name)}</strong><br><small>Código: ${esc(p.code || '—')}</small></div>
            <span class="badge ${p.stock === 0 ? 'out' : 'low'}">${p.stock} / min ${p.min_stock}</span></li>`).join('')}</ul>`
            : '<ul><li>✅ Todo el inventario está por encima del mínimo</li></ul>'}
        </div>
        <div class="panel">
          <h4>🔄 Últimos movimientos</h4>
          ${d.recentMovements.length ? `<ul>${d.recentMovements.map(m => `
            <li><div><strong>${esc(m.product_name)}</strong><br><small>${fmtDate(m.created_at)} · ${esc(m.user_name)}</small></div>
            <span class="${m.quantity >= 0 ? 'positive' : 'negative'}">${m.quantity >= 0 ? '+' : ''}${m.quantity}</span></li>`).join('')}</ul>`
            : '<ul><li>Sin movimientos registrados aún</li></ul>'}
        </div>
      </div>`;
  } catch (err) { toast(err.message, 'error'); }
}

/* ================= HELPERS COMPARTIDOS DE FECHA ================= */
function localDateStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* ================= INICIO ================= */
(async function init() {
  if (!token) {
    document.getElementById('login-view').classList.remove('hidden');
    return;
  }
  try {
    const me = await api('/auth/me');
    currentUser = me.user;
    enterApp();
  } catch { logout(); }
})();