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

/* ================= PRODUCTOS ================= */
let searchTimer;
function debouncedLoadProducts() { clearTimeout(searchTimer); searchTimer = setTimeout(loadProducts, 300); }

async function loadCategoryFilter() {
  try {
    const cats = await api('/categories');
    const sel = document.getElementById('product-category-filter');
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  } catch (err) { /* silencioso */ }
}

async function loadProducts() {
  try {
    const params = new URLSearchParams();
    const s = document.getElementById('product-search').value.trim();
    if (s) params.set('search', s);
    if (document.getElementById('product-category-filter').value) params.set('category_id', document.getElementById('product-category-filter').value);
    if (document.getElementById('low-stock-filter').checked) params.set('low_stock', '1');

    const products = await api('/products?' + params.toString());
    const isAdmin = currentUser.role === 'admin';

    document.getElementById('products-table').innerHTML = `
      <thead><tr>
        <th>Código</th><th>Producto</th><th>Categoría</th>
        <th>Costo</th><th>Precio</th><th>Stock</th>
        ${isAdmin ? '<th style="text-align:right">Acciones</th>' : ''}
      </tr></thead>
      <tbody>
        ${products.length ? products.map(p => `
          <tr>
            <td><code>${esc(p.code)}</code></td>
            <td><strong>${esc(p.name)}</strong>${p.description ? `<br><small style="color:var(--muted)">${esc(p.description)}</small>` : ''}</td>
            <td>${esc(p.category_name || '—')}</td>
            <td>${money(p.cost_price)}</td>
            <td><strong>${money(p.sale_price)}</strong></td>
            <td><span class="badge ${p.stock === 0 ? 'out' : p.stock <= p.min_stock ? 'low' : 'ok'}">${p.stock} ${esc(p.unit)}</span></td>
            ${isAdmin ? `
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick="openProductModal(${p.id})">✏️ Editar</button>
              <button class="btn btn-danger btn-small" onclick="deleteProduct(${p.id}, '${esc(p.name).replace(/'/g, "\\'")}')">🗑</button>
            </div></td>` : ''}
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="7">No se encontraron productos. ¡Agrega el primero!</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

async function openProductModal(id = null) {
  const cats = await api('/categories');
  let product = { unit: 'unidad', min_stock: 5 };
  if (id) product = await api('/products/' + id);

  openModal(id ? 'Editar producto' : 'Nuevo producto', `
    <form id="product-form">
      <div class="form-grid">
        <div><label>Código (opcional)</label><input name="code" value="${esc(product.code || '')}" placeholder="Automático"></div>
        <div><label>Categoría</label>
          <select name="category_id">
            <option value="">Sin categoría</option>
            ${cats.map(c => `<option value="${c.id}" ${product.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <div class="full"><label>Nombre *</label><input name="name" required value="${esc(product.name || '')}"></div>
        <div class="full"><label>Descripción</label><input name="description" value="${esc(product.description || '')}"></div>
        <div><label>Unidad</label><input name="unit" value="${esc(product.unit)}" placeholder="unidad, caja, docena..."></div>
        <div><label>Stock mínimo</label><input name="min_stock" type="number" min="0" value="${product.min_stock}"></div>
        <div><label>Precio de costo</label><input name="cost_price" type="number" step="any" min="0" value="${product.cost_price ?? ''}"></div>
        <div><label>Precio de venta *</label><input name="sale_price" type="number" step="any" min="0" value="${product.sale_price ?? ''}" required></div>
        ${id ? `<div><label>Stock actual (editar con cuidado)</label><input name="stock" type="number" min="0" value="${product.stock}"></div>`
              : `<div><label>Stock inicial</label><input name="stock" type="number" min="0" value="0"></div>`}
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">${id ? 'Guardar cambios' : 'Crear producto'}</button>
      </div>
    </form>`);

  document.getElementById('product-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const body = Object.fromEntries(new FormData(f));
    try {
      id ? await api('/products/' + id, { method: 'PUT', body })
         : await api('/products', { method: 'POST', body });
      closeModal(); toast(id ? 'Producto actualizado' : 'Producto creado'); loadProducts(); loadPosProducts();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function deleteProduct(id, name) {
  if (!confirm(`¿Eliminar el producto "${name}"? No aparecerá más en el inventario.`)) return;
  try { await api('/products/' + id, { method: 'DELETE' }); toast('Producto eliminado'); loadProducts(); }
  catch (err) { toast(err.message, 'error'); }
}

/* ================= MOVIMIENTOS ================= */
async function openMovementModal() {
  const products = await api('/products');
  if (!products.length) return toast('Primero debes crear productos', 'error');

  switchView('movimientos');
  openModal('Registrar movimiento', `
    <form id="movement-form">
      <div class="form-grid">
        <div class="full"><label>Producto</label>
          <select name="product_id" required>
            ${products.map(p => `<option value="${p.id}">${esc(p.name)} — stock: ${p.stock} ${esc(p.unit)}</option>`).join('')}
          </select></div>
        <div><label>Tipo</label>
          <select name="type" id="movement-type-select">
            <option value="entrada">⬆️ Entrada (compra / ingreso)</option>
            <option value="salida">⬇️ Salida (venta / baja)</option>
            <option value="ajuste">⚖️ Ajuste (inventario físico)</option>
          </select></div>
        <div><label id="quantity-label">Cantidad a ingresar</label><input name="quantity" type="number" min="1" required></div>
        <div class="full"><label>Motivo / observación</label><input name="reason" placeholder="Ej: compra proveedor X, venta mostrador..."></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Registrar</button>
      </div>
    </form>`);

  const updateLabel = () => {
    document.getElementById('quantity-label').textContent =
      { entrada: 'Cantidad a ingresar', salida: 'Cantidad a retirar', ajuste: 'Nuevo total físico en inventario' }[document.getElementById('movement-type-select').value];
  };
  document.getElementById('movement-type-select').addEventListener('change', updateLabel);

  document.getElementById('movement-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      const r = await api('/movements', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
      closeModal(); toast(r.message); loadMovements();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function loadMovements() {
  try {
    const params = new URLSearchParams();
    if (document.getElementById('movement-type-filter').value) params.set('type', document.getElementById('movement-type-filter').value);
    if (document.getElementById('movement-from').value) params.set('from', document.getElementById('movement-from').value);
    if (document.getElementById('movement-to').value) params.set('to', document.getElementById('movement-to').value);

    const moves = await api('/movements?' + params.toString());
    const isAdmin = currentUser.role === 'admin';
    document.getElementById('movements-table').innerHTML = `
      <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th>${isAdmin ? '<th style="text-align:right">Acciones</th>' : ''}</tr></thead>
      <tbody>
        ${moves.length ? moves.map(m => `
          <tr>
            <td>${fmtDate(m.created_at)}</td>
            <td><strong>${esc(m.product_name)}</strong> <code>${esc(m.product_code || '')}</code></td>
            <td><span class="badge type-${m.type}">${m.type.toUpperCase()}</span></td>
            <td class="${m.quantity >= 0 ? 'positive' : 'negative'}">${m.quantity >= 0 ? '+' : ''}${m.quantity}</td>
            <td>${esc(m.reason || '—')}</td>
            <td>${esc(m.user_name)}</td>
            ${isAdmin ? `<td><div class="actions-cell"><button class="btn btn-danger btn-small" onclick="deleteMovement(${m.id}, '${esc(m.product_name).replace(/'/g, "\\'")}')">🗑</button></div></td>` : ''}
          </tr>`).join('')
          : `<tr class="empty-row"><td colspan="${isAdmin ? 7 : 6}">No hay movimientos registrados</td></tr>`
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteMovement(id, productName) {
  if (!confirm(`¿Eliminar el movimiento de "${productName}"? El stock se restaurará.`)) return;
  try { await api('/movements/' + id, { method: 'DELETE' }); toast('Movimiento eliminado'); loadMovements(); }
  catch (err) { toast(err.message, 'error'); }
}

/* ================= CATEGORÍAS ================= */
async function loadCategoriesTable() {
  try {
    const cats = await api('/categories');
    document.getElementById('categories-table').innerHTML = `
      <thead><tr><th>Nombre</th><th>Productos</th><th style="text-align:right">Acciones</th></tr></thead>
      <tbody>
        ${cats.length ? cats.map(c => `
          <tr>
            <td><strong>${esc(c.name)}</strong></td>
            <td>${c.product_count}</td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick='openCategoryModal(${JSON.stringify({ id: c.id, name: c.name })})'>✏️ Editar</button>
              <button class="btn btn-danger btn-small" onclick="deleteCategory(${c.id}, '${esc(c.name).replace(/'/g, "\\'")}')">🗑</button>
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="3">No hay categorías. Crea la primera para organizar tus productos.</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openCategoryModal(cat = null) {
  openModal(cat ? 'Editar categoría' : 'Nueva categoría', `
    <form id="category-form">
      <div class="form-grid">
        <div class="full"><label>Nombre *</label><input name="name" required value="${esc(cat?.name || '')}" placeholder="Ej: Aseo, Papelería, Dulces"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  document.getElementById('category-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      cat ? await api('/categories/' + cat.id, { method: 'PUT', body: { name: f.name.value } })
          : await api('/categories', { method: 'POST', body: { name: f.name.value } });
      closeModal(); toast('Categoría guardada'); loadCategoriesTable();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function deleteCategory(id, name) {
  if (!confirm(`¿Eliminar la categoría "${name}"?`)) return;
  try { await api('/categories/' + id, { method: 'DELETE' }); toast('Categoría eliminada'); loadCategoriesTable(); }
  catch (err) { toast(err.message, 'error'); }
}

/* ================= USUARIOS ================= */
async function loadUsersTable() {
  try {
    const users = await api('/users');
    document.getElementById('users-table').innerHTML = `
      <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Comisión</th><th>Estado</th><th style="text-align:right">Acciones</th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td><strong>@${esc(u.username)}</strong></td>
            <td>${esc(u.full_name)}</td>
            <td><span class="badge role-${u.role}">${u.role === 'admin' ? 'Administrador' : 'Colaborador'}</span></td>
            <td>${u.commission_rate != null ? `<strong>${u.commission_rate}%</strong> <small style="color:var(--muted)">(individual)</small>` : `<small style="color:var(--muted)">general (${storeSettings.commission_rate || 15}%)</small>`}</td>
            <td>${u.active ? '<span class="badge ok">Activo</span>' : '<span class="badge inactive">Inactivo</span>'}</td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick='openUserModal(${JSON.stringify(u)})'>✏️ Editar</button>
              <button class="btn btn-outline btn-small" onclick="openResetPasswordModal(${u.id}, '${esc(u.full_name).replace(/'/g, "\\'")}')">🔑</button>
              ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-small" onclick="deleteUser(${u.id}, '${esc(u.username).replace(/'/g, "\\'")}')">🗑</button>` : ''}
            </div></td>
          </tr>`).join('')}
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openUserModal(user = null) {
  openModal(user ? 'Editar colaborador' : 'Nuevo colaborador', `
    <form id="user-form">
      <div class="form-grid">
        <div><label>Usuario *</label><input name="username" ${user ? 'readonly' : 'required'} value="${esc(user?.username || '')}"></div>
        <div><label>Rol</label>
          <select name="role">
            <option value="vendedor" ${user?.role === 'vendedor' ? 'selected' : ''}>Colaborador</option>
            <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select></div>
        <div class="full"><label>Nombre completo *</label><input name="full_name" required value="${esc(user?.full_name || '')}"></div>
        <div><label>Comisión %</label><input name="commission_rate" type="number" min="0" max="100" step="any" value="${user?.commission_rate ?? ''}" placeholder="Vacío = general (${storeSettings.commission_rate || 15}%)"></div>
        <div class="full"><label>${user ? `Nueva contraseña (dejar vacío para no cambiar)` : 'Contraseña * (mínimo 6)'}</label>
          <input name="password" type="password" ${user ? '' : 'required minlength="6"'} minlength="6" autocomplete="new-password"></div>
        ${user ? `<div class="full checkbox-label"><input type="checkbox" name="active" ${user.active ? 'checked' : ''}> Usuario activo (puede iniciar sesión)</div>` : ''}
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  document.getElementById('user-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const body = Object.fromEntries(new FormData(f));
    if (!body.password) delete body.password;
    if (f.active) body.active = f.active.checked ? 1 : 0;
    try {
      user ? await api('/users/' + user.id, { method: 'PUT', body })
           : await api('/users', { method: 'POST', body });
      closeModal(); toast('Colaborador guardado'); loadUsersTable();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function deleteUser(id, username) {
  if (!confirm(`¿Desactivar al colaborador "@${username}"? Ya no podrá iniciar sesión.`)) return;
  try { await api('/users/' + id, { method: 'DELETE' }); toast('Colaborador desactivado'); loadUsersTable(); }
  catch (err) { toast(err.message, 'error'); }
}

function openResetPasswordModal(userId, fullName) {
  openModal('Restablecer contraseña', `
    <form id="reset-password-form">
      <p style="margin:0 0 1rem;color:var(--muted)">Establecer nueva contraseña para <strong>${esc(fullName)}</strong></p>
      <div class="form-grid">
        <div class="full"><label>Nueva contraseña (mínimo 6 caracteres)</label>
          <input name="new_password" type="password" required minlength="6" autocomplete="new-password"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Restablecer</button>
      </div>
    </form>`);
  document.getElementById('reset-password-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('/users/' + userId + '/reset-password', {
        method: 'POST',
        body: { new_password: f.new_password.value }
      });
      closeModal(); toast('Contraseña restablecida correctamente');
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

/* ================= COMISIONES ================= */
function localDateStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function initCommissionsView() {
  const fromEl = document.getElementById('comm-from');
  const toEl = document.getElementById('comm-to');
  if (!fromEl.value) fromEl.value = localDateStr(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  if (!toEl.value) toEl.value = localDateStr(new Date());
  loadCommissions();
}

async function loadCommissions() {
  try {
    const params = new URLSearchParams({
      from: document.getElementById('comm-from').value,
      to: document.getElementById('comm-to').value
    });
    const d = await api('/users/commissions?' + params.toString());
    document.getElementById('commissions-hint').textContent = d.is_admin
      ? 'La comisión se calcula sobre todas las ventas del período (facturas anuladas no cuentan). Las ventas fiadas se muestran aparte hasta que se cobren.'
      : `Estas son tus ventas del período. Tu comisión: ${d.commission_rate}% sobre cada venta (las anuladas no cuentan). Las ventas fiadas se suman cuando el cliente paga.`;

    document.getElementById('commissions-table').innerHTML = `
      <thead><tr>
        <th>Colaborador</th><th>Facturas</th><th>Ventas cobradas</th><th>Fiadas (por cobrar)</th><th>Total ventas</th><th>Comisión %</th><th>Comisión ganada</th><th style="text-align:right">Acciones</th>
      </tr></thead>
      <tbody>
        ${d.collaborators.length ? d.collaborators.map(c => `
          <tr>
            <td><strong>${esc(c.full_name)}</strong> <small style="color:var(--muted)">@${esc(c.username)}</small></td>
            <td>${c.invoice_count}</td>
            <td>${money(c.paid_total)}</td>
            <td>${c.pending_total > 0 ? `<span class="badge pay-fiado">${money(c.pending_total)}</span>` : money(0)}</td>
            <td><strong>${money(c.total_sales)}</strong></td>
            <td>${c.commission_rate}%${c.commission_rate === d.commission_rate ? ' <small style="color:var(--muted)">(general)</small>' : ' <small style="color:var(--muted)">(individual)</small>'}</td>
            <td><strong class="positive">${money(c.commission)}</strong></td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick="viewSellerSales(${c.id}, '${esc(c.full_name).replace(/'/g, "\\'")}')">🧾 Ver ventas${d.is_admin ? ' / anular' : ''}</button>
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="8">Sin ventas registradas en este período.</td></tr>'
        }
      </tbody>
      ${d.collaborators.length ? `<tfoot><tr>
        <td>TOTAL</td>
        <td>${d.collaborators.reduce((a, c) => a + c.invoice_count, 0)}</td>
        <td>${money(d.collaborators.reduce((a, c) => a + c.paid_total, 0))}</td>
        <td>${money(d.collaborators.reduce((a, c) => a + c.pending_total, 0))}</td>
        <td>${money(d.collaborators.reduce((a, c) => a + c.total_sales, 0))}</td>
        <td></td>
        <td class="positive">${money(d.collaborators.reduce((a, c) => a + c.commission, 0))}</td>
        <td></td>
      </tr></tfoot>` : ''}`;
  } catch (err) { toast(err.message, 'error'); }
}

/* Detalle de las facturas de un colaborador en el período actual de
   Comisiones; permite al admin anular una venta mal registrada. */
async function viewSellerSales(userId, fullName) {
  try {
    const params = new URLSearchParams({
      from: document.getElementById('comm-from').value,
      to: document.getElementById('comm-to').value,
      seller: userId
    });
    const invoices = await api('/invoices?' + params.toString());
    const isAdmin = currentUser.role === 'admin';
    const valid = invoices.filter(i => i.status !== 'anulada');
    const total = valid.reduce((a, i) => a + i.total, 0);

    openModal(`🧾 Ventas de ${fullName}`, `
      <p class="config-hint">
        ${valid.length} venta(s) válida(s) por ${money(total)} · Las anuladas no suman comisión.
        ${isAdmin ? 'Puedes anular una venta registrada por error: el stock vuelve al inventario y la comisión se descuenta sola.' : ''}
      </p>
      <table class="mini-table">
        <thead><tr>
          <th>Factura</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Estado</th>${isAdmin ? '<th style="text-align:right">Acción</th>' : ''}
        </tr></thead>
        <tbody>
          ${invoices.length ? invoices.map(i => `
            <tr${i.status === 'anulada' ? ' style="opacity:.55"' : ''}>
              <td><strong>FV-${String(i.number).padStart(6, '0')}</strong></td>
              <td>${fmtDate(i.created_at)}</td>
              <td>${esc(i.customer_name || i.client_name || 'Mostrador')}</td>
              <td>${money(i.total)}</td>
              <td><span class="badge pay-${i.payment_method}">${i.payment_method}</span></td>
              <td><span class="badge status-${i.status}">${i.status}${(i.status === 'pendiente' && Number(i.paid_amount) > 0) ? ` · abonado ${money(i.paid_amount)}` : ''}</span></td>
              ${isAdmin ? `<td>${i.status !== 'anulada' ? `<button class="btn btn-danger btn-small" onclick="voidSaleFromCommissions(${i.id}, ${userId}, '${esc(fullName).replace(/'/g, "\\'")}')">🚫 Anular</button>` : '<small>anulada</small>'}</td>` : ''}
            </tr>`).join('')
          : '<tr class="empty-row"><td colspan="7">Sin ventas en este período.</td></tr>'}
        </tbody>
        ${valid.length ? `<tfoot><tr>
          <td colspan="3" class="t-right"><strong>Total que suma comisión</strong></td>
          <td class="t-right"><strong>${money(total)}</strong></td>
          <td colspan="${isAdmin ? 3 : 2}"></td>
        </tr></tfoot>` : ''}
      </table>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cerrar</button>
      </div>
    `, { wide: true });
  } catch (err) { toast(err.message, 'error'); }
}

async function voidSaleFromCommissions(invoiceId, userId, fullName) {
  if (!confirm('¿Anular esta factura? El stock vuelve al inventario y dejará de contar para la comisión.')) return;
  try {
    const r = await api(`/invoices/${invoiceId}/void`, { method: 'POST' });
    toast(r.message);
    loadCommissions();
    viewSellerSales(userId, fullName);
  } catch (err) { toast(err.message, 'error'); }
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

/* ================= FACTURAR (PUNTO DE VENTA) ================= */
/* El carrito admite dos tipos de línea:
   - kind 'product': producto del inventario (descuenta stock)
   - kind 'free'   : artículo escrito a mano (nombre y precio libres) */
const cart = new Map();
let cartUid = 0;
let searchPosTimer;
let posProductCache = [];

function debouncedLoadPosProducts() { clearTimeout(searchPosTimer); searchPosTimer = setTimeout(loadPosProducts, 250); }

function todayStr() { return localDateStr(new Date()); }

async function resetPos() {
  cart.clear(); cartUid = 0;
  document.getElementById('pos-cash-received').value = '';
  document.getElementById('pos-payment').value = 'efectivo';
  const dateEl = document.getElementById('pos-date');
  if (dateEl) dateEl.value = todayStr();
  for (const id of ['pos-client-name', 'pos-client-address', 'pos-client-phone', 'pos-client-email']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  renderCart(); renderPosChange(); updateCashRowVisibility();
}

function clearPosCart() {
  cart.clear();
  renderCart();
}

function updateCashRowVisibility() {
  const method = document.getElementById('pos-payment').value;
  document.getElementById('pos-cash-row').classList.toggle('hidden', method !== 'efectivo');
}
document.getElementById('pos-payment').addEventListener('change', () => { updateCashRowVisibility(); renderPosChange(); });

/* Lista de productos para el selector (modal "Agregar productos") */
function openPosPicker() {
  openModal('🔍 Agregar productos a la venta', `
    <input type="search" id="pos-search" placeholder="Buscar producto por nombre o código..." oninput="debouncedLoadPosProducts()" autofocus>
    <div id="pos-products" class="pos-products pos-picker-grid"></div>
    <p class="config-hint" style="margin-top:.75rem">Haz clic en un producto para agregarlo. Puedes agregarlo varias veces.</p>`);

  const search = document.getElementById('pos-search');
  setTimeout(() => search.focus(), 50);
  search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPosProducts(); } });
  loadPosProducts();
}

/* Agrega desde el caché del selector (evita problemas con comillas en nombres) */
function addFromPicker(index) {
  const p = posProductCache[index];
  if (p) addToCart(p);
}

async function loadPosProducts() {
  try {
    const params = new URLSearchParams();
    const s = document.getElementById('pos-search')?.value.trim() || '';
    if (s) params.set('search', s);

    const products = await api('/products?' + params.toString());
    posProductCache = products;
    const box = document.getElementById('pos-products');
    if (!box) return;

    box.innerHTML = products.length ? products.map((p, i) => {
      const inCart = [...cart.values()].some(e => e.kind === 'product' && e.product.id === p.id);
      return `
      <button type="button" class="pos-product ${inCart ? 'in-cart' : ''}"
        onclick="addFromPicker(${i})"
        ${p.stock === 0 ? 'disabled' : ''}
        title="${p.stock === 0 ? 'Sin stock' : 'Clic para agregar'}">
        <span class="pos-stock">Stock: ${p.stock}</span>
        <strong>${esc(p.name)}</strong>
        <small>${esc(p.code || 'sin código')}</small>
        <span class="pos-price">${money(p.sale_price)}</span>
      </button>`;
    }).join('')
    : '<p class="pos-empty">No se encontraron productos</p>';
  } catch (err) { toast(err.message, 'error'); }
}

async function loadPosCustomers() {
  try {
    const customers = await api('/customers');
    const sel = document.getElementById('pos-customer');
    sel.innerHTML = '<option value="">Venta de mostrador</option>' +
      customers.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' — ' + esc(c.phone) : ''}</option>`).join('');
  } catch { /* silencioso */ }
}

/* Vendedores activos para el selector del punto de venta */
let posSellers = [];
async function loadPosSellers() {
  try {
    posSellers = await api('/users/sellers');
    const sel = document.getElementById('pos-seller');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Sin vendedor —</option>' +
      posSellers.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('');
    if (currentUser && posSellers.some(u => u.id === currentUser.id)) sel.value = currentUser.id;
    renderPosCommission();
  } catch { /* silencioso */ }
}

/* Muestra la comisión estimada de la venta actual según el vendedor elegido */
function renderPosCommission() {
  const el = document.getElementById('pos-commission');
  if (!el) return;
  const sellerId = Number(document.getElementById('pos-seller')?.value);
  if (!sellerId || !cart.size) { el.textContent = ''; return; }
  const s = posSellers.find(u => u.id === sellerId);
  if (!s) { el.textContent = ''; return; }
  const rate = Math.min(100, Math.max(0, Number(s.commission_rate ?? storeSettings.commission_rate) || 0));
  if (!rate) { el.textContent = ''; return; }
  el.textContent = `💡 Comisión de ${s.full_name}: ${money(Math.round(cartTotal() * rate / 100))} (${rate}%)`;
}

function addToCart(p) {
  const entry = [...cart.values()].find(e => e.kind === 'product' && e.product.id === p.id);
  if (entry) {
    if (entry.qty + 1 > p.stock) return toast(`Solo hay ${p.stock} unidades de "${p.name}"`, 'error');
    entry.qty++;
  } else {
    if (p.stock < 1) return toast(`"${p.name}" no tiene stock disponible`, 'error');
    cart.set(++cartUid, { uid: cartUid, kind: 'product', product: p, qty: 1 });
  }
  renderCart();
}

/* Agrega una línea vacía escrita a mano para completar nombre, precio y cantidad */
function addFreeItem() {
  cart.set(++cartUid, { uid: cartUid, kind: 'free', name: '', price: '', qty: 1 });
  renderCart(true);
}

function updateFreeItem(uid, field, value) {
  const e = cart.get(uid);
  if (!e || e.kind !== 'free') return;
  if (field === 'name') e.name = String(value).slice(0, 120);
  if (field === 'price') {
    const n = Number(value);
    e.price = value === '' ? '' : Math.max(0, Math.round(n * 100) / 100);
  }
  if (field === 'qty') {
    const q = parseInt(value, 10);
    e.qty = Number.isInteger(q) && q > 0 ? q : 1;
  }
  renderCart();
}

function changeQty(id, delta) {
  const e = cart.get(id);
  if (!e) return;
  e.qty += delta;
  if (e.qty <= 0) { cart.delete(id); }
  else if (e.kind === 'product' && e.qty > e.product.stock) { e.qty = e.product.stock; toast(`Máximo ${e.product.stock} unidades disponibles`, 'error'); }
  renderCart();
}

function setQty(id, value) {
  const e = cart.get(id);
  if (!e) return;
  const qty = parseInt(value, 10);
  if (!Number.isInteger(qty) || qty <= 0) { cart.delete(id); }
  else e.qty = e.kind === 'product' ? Math.min(qty, e.product.stock) : qty;
  renderCart();
}

function removeFromCart(id) { cart.delete(id); renderCart(); }

function cartTotal() {
  let total = 0;
  for (const e of cart.values()) total += Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty);
  return total;
}

/* % de IVA/impuesto de la venta actual (los precios ya lo incluyen) */
function posTaxRate() {
  const v = Number(document.getElementById('pos-tax-rate')?.value);
  return Number.isFinite(v) && v > 0 ? Math.min(100, v) : 0;
}

function renderPosTotals() {
  const total = cartTotal();
  const rate = posTaxRate();
  const subtotal = rate ? Math.round(total / (1 + rate / 100)) : total;
  document.getElementById('pos-subtotal').textContent = money(subtotal);
  document.getElementById('pos-tax').textContent = money(rate ? total - subtotal : 0);
  document.getElementById('pos-total').textContent = money(total);
  renderPosCommission();
}

function renderCart(focusFirstFree = false) {
  const table = document.getElementById('pos-cart');
  if (!cart.size) {
    table.innerHTML = `
      <thead><tr><th>Código</th><th>Descripción</th><th class="t-center">Cant.</th><th class="t-right">Precio unit.</th><th class="t-right">Precio total</th><th></th></tr></thead>
      <tbody><tr class="empty-row"><td colspan="6">La venta está vacía.<br>Usa <strong>🔍 Agregar productos</strong> para empezar o agrega un artículo escrito a mano.</td></tr></tbody>`;
  } else {
    table.innerHTML = `
      <thead><tr>
        <th style="width:110px">Código</th>
        <th>Descripción</th>
        <th class="t-center" style="width:120px">Cant.</th>
        <th class="t-right" style="width:130px">Precio unit.</th>
        <th class="t-right" style="width:130px">Precio total</th>
        <th style="width:44px"></th>
      </tr></thead>
      <tbody>
        ${[...cart.values()].map(e => {
          const lineTotal = Math.round((Number(e.price ?? e.product?.sale_price) || 0) * e.qty);
          if (e.kind === 'product') {
            return `
              <tr>
                <td><code class="pos-code">${esc(e.product.code || '—')}</code></td>
                <td class="pos-desc">
                  <strong>${esc(e.product.name)}</strong>
                  <small>${e.product.stock} en inventario${e.product.unit ? ' · ' + esc(e.product.unit) : ''}</small>
                </td>
                <td class="t-center">
                  <div class="qty-controls">
                    <button type="button" onclick="changeQty(${e.uid}, -1)">−</button>
                    <input type="number" min="1" max="${e.product.stock}" value="${e.qty}" onchange="setQty(${e.uid}, this.value)">
                    <button type="button" onclick="changeQty(${e.uid}, 1)">＋</button>
                  </div>
                </td>
                <td class="t-right">${money(e.product.sale_price)}</td>
                <td class="t-right pos-line-total">${money(lineTotal)}</td>
                <td><button type="button" class="pos-trash" title="Eliminar fila" onclick="removeFromCart(${e.uid})">🗑</button></td>
              </tr>`;
          }
          return `
            <tr class="free-row">
              <td><code class="pos-code">—</code></td>
              <td class="pos-desc">
                <input type="text" class="ci-free-name" maxlength="120" placeholder="Nombre del artículo..."
                  value="${esc(e.name)}" onchange="updateFreeItem(${e.uid}, 'name', this.value)">
              </td>
              <td class="t-center">
                <div class="qty-controls">
                  <button type="button" onclick="changeQty(${e.uid}, -1)">−</button>
                  <input type="number" min="1" step="1" value="${e.qty}" onchange="setQty(${e.uid}, this.value)">
                  <button type="button" onclick="changeQty(${e.uid}, 1)">＋</button>
                </div>
              </td>
              <td class="t-right"><input type="number" class="pos-price-input" min="0" step="any" placeholder="0"
                value="${e.price}" onchange="updateFreeItem(${e.uid}, 'price', this.value)"></td>
              <td class="t-right pos-line-total">${money(lineTotal)}</td>
              <td><button type="button" class="pos-trash" title="Eliminar fila" onclick="removeFromCart(${e.uid})">🗑</button></td>
            </tr>`;
        }).join('')}
      </tbody>`;
  }
  renderPosTotals();

  if (focusFirstFree) {
    const first = table.querySelector('.free-row .ci-free-name');
    if (first) first.focus();
  }
}

function renderPosChange() {
  const el = document.getElementById('pos-change');
  const received = Number(document.getElementById('pos-cash-received').value);
  const total = cartTotal();

  if (document.getElementById('pos-payment').value !== 'efectivo' || !received || !total) {
    el.textContent = ''; return;
  }
  if (received < total) {
    el.textContent = '⚠️ Falta ' + money(total - received);
    el.style.color = 'var(--red)';
  } else {
    el.textContent = 'Cambio: ' + money(received - total);
    el.style.color = 'var(--green)';
  }
}

async function createInvoice() {
  if (!cart.size) return toast('El carrito está vacío', 'error');

  for (const e of cart.values()) {
    if (e.kind === 'free' && (!e.name.trim() || !(Number(e.price) > 0))) {
      return toast('Completa el nombre y el precio del artículo escrito a mano', 'error');
    }
  }

  const body = {
    items: [...cart.values()].map(e => e.kind === 'product'
      ? { product_id: e.product.id, quantity: e.qty }
      : { name: e.name.trim(), unit_price: Number(e.price), quantity: e.qty }),
    customer_id: document.getElementById('pos-customer').value || null,
    seller_user_id: document.getElementById('pos-seller').value || null,
    payment_method: document.getElementById('pos-payment').value,
    client_name: document.getElementById('pos-client-name').value.trim(),
    client_address: document.getElementById('pos-client-address').value.trim(),
    client_phone: document.getElementById('pos-client-phone').value.trim(),
    client_email: document.getElementById('pos-client-email').value.trim()
  };

  try {
    const r = await api('/invoices', { method: 'POST', body });
    toast(r.message);
    if (r.commission_amount > 0) toast(`💡 Comisión registrada: ${money(r.commission_amount)}`);
    const invoiceId = r.id;
    resetPos();
    loadPosProducts();
    printInvoice(invoiceId);
  } catch (err) { toast(err.message, 'error'); }
}

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
    return `
      <div class="debt-card manual ${c.status}">
        <div class="debt-info">
          <div class="debt-card-top">
            <span class="avatar">${esc(c.customer_name.trim().charAt(0).toUpperCase())}</span>
            <div class="debt-card-id">
              <h4 title="${esc(c.customer_name)}">${esc(c.customer_name)}</h4>
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

function openCardModal(card = null) {
  openModal(card ? 'Editar tarjeta de cobro' : 'Nueva tarjeta de cobro', `
    <form id="fcard-form">
      <div class="form-grid">
        <div class="full"><label>Nombre del cliente *</label><input name="customer_name" required maxlength="80" value="${esc(card?.customer_name || '')}" placeholder="Ej: María Gómez"></div>
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
        ${isAdmin ? `<button type="button" class="btn btn-danger btn-small" onclick="deleteCard(${c.id}, '${esc(c.customer_name).replace(/'/g, "\\'")}')">🗑</button>` : ''}
        ${c.status === 'pendiente' ? '<button class="btn btn-primary" onclick="document.getElementById(\'card-payment-form\').requestSubmit()">💵 Registrar abono</button>' : ''}
      </div>
    `, { wide: true });

    const form = document.getElementById('card-payment-form');
    if (form) form.addEventListener('submit', ev => {
      ev.preventDefault();
      registerManualPayment(c.id, new FormData(ev.target), ev.target);
    });
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

/* ================= CLIENTES ================= */
async function loadCustomersTable() {
  try {
    const customers = await api('/customers');
    document.getElementById('customers-table').innerHTML = `
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Notas</th><th style="text-align:right">Acciones</th></tr></thead>
      <tbody>
        ${customers.length ? customers.map(c => `
          <tr>
            <td><strong>${esc(c.name)}</strong></td>
            <td>${esc(c.phone || '—')}</td>
            <td>${esc(c.notes || '—')}</td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick='openCustomerModal(${JSON.stringify(c)})'>✏️ Editar</button>
              <button class="btn btn-danger btn-small" onclick="deleteCustomer(${c.id}, '${esc(c.name).replace(/'/g, "\\'")}')">🗑</button>
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="4">No hay clientes registrados. Crea el primero con el botón de arriba.</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openCustomerModal(customer = null) {
  openModal(customer ? 'Editar cliente' : 'Nuevo cliente', `
    <form id="customer-form">
      <div class="form-grid">
        <div class="full"><label>Nombre completo *</label><input name="name" required value="${esc(customer?.name || '')}"></div>
        <div class="full"><label>Teléfono</label><input name="phone" value="${esc(customer?.phone || '')}" placeholder="Ej: 11 2345-6789"></div>
        <div class="full"><label>Notas</label><input name="notes" value="${esc(customer?.notes || '')}" placeholder="Dirección, referencia..."></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  document.getElementById('customer-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const body = Object.fromEntries(new FormData(f));
    try {
      customer ? await api('/customers/' + customer.id, { method: 'PUT', body })
               : await api('/customers', { method: 'POST', body });
      closeModal(); toast('Cliente guardado'); loadCustomersTable(); loadPosCustomers();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function deleteCustomer(id, name) {
  if (!confirm(`¿Eliminar al cliente "${name}"? Sus facturas anteriores se conservan.`)) return;
  try { await api('/customers/' + id, { method: 'DELETE' }); toast('Cliente eliminado'); loadCustomersTable(); }
  catch (err) { toast(err.message, 'error'); }
}

/* ================= PROVEEDORES ================= */
let supplierTimer;
function debouncedLoadSuppliers() { clearTimeout(supplierTimer); supplierTimer = setTimeout(loadSuppliers, 300); }

async function loadSuppliers() {
  try {
    const search = document.getElementById('supplier-search')?.value || '';
    const params = search ? '?search=' + encodeURIComponent(search) : '';
    const list = await api('/suppliers' + params);
    document.getElementById('suppliers-table').innerHTML = `
      <thead><tr><th>#</th><th>Nombre</th><th>Documento</th><th>Teléfono</th><th>Correo</th><th>Dirección</th><th style="text-align:right">Acciones</th></tr></thead>
      <tbody>
        ${list.length ? list.map((s, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.document || '—')}</td>
            <td>${s.phone ? `<a href="https://wa.me/${s.phone.replace(/[^0-9]/g, '')}" target="_blank" style="color:#25d366">${esc(s.phone)}</a>` : '—'}</td>
            <td>${esc(s.email || '—')}</td>
            <td>${esc(s.address || '—')}</td>
            <td><div class="actions-cell">
              <button class="btn btn-outline btn-small" onclick='openSupplierModal(${JSON.stringify(s)})'>✏️ Editar</button>
              <button class="btn btn-danger btn-small" onclick="deleteSupplier(${s.id}, '${esc(s.name).replace(/'/g, "\\'")}')">🗑</button>
            </div></td>
          </tr>`).join('')
          : '<tr class="empty-row"><td colspan="7">No hay proveedores registrados. Crea el primero con el botón de arriba.</td></tr>'
        }
      </tbody>`;
  } catch (err) { toast(err.message, 'error'); }
}

function openSupplierModal(supplier = null) {
  openModal(supplier ? 'Editar proveedor' : 'Nuevo proveedor', `
    <form id="supplier-form">
      <div class="form-grid">
        <div class="full"><label>Nombre *</label><input name="name" required value="${esc(supplier?.name || '')}" placeholder="Ej: Distribuidora ABC"></div>
        <div><label>Documento (RUC/DNI)</label><input name="document" value="${esc(supplier?.document || '')}" placeholder="Ej: 30-71234567-8"></div>
        <div><label>Teléfono</label><input name="phone" value="${esc(supplier?.phone || '')}" placeholder="Ej: +54 9 261 123-4567"></div>
        <div class="full"><label>Correo</label><input name="email" type="email" value="${esc(supplier?.email || '')}" placeholder="ventas@proveedor.com"></div>
        <div class="full"><label>Dirección</label><input name="address" value="${esc(supplier?.address || '')}" placeholder="Av. Los Álamos 456"></div>
        <p class="form-error"></p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  document.getElementById('supplier-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const body = Object.fromEntries(new FormData(f));
    try {
      supplier ? await api('/suppliers/' + supplier.id, { method: 'PUT', body })
               : await api('/suppliers', { method: 'POST', body });
      closeModal(); toast('Proveedor guardado'); loadSuppliers();
    } catch (err) { f.querySelector('.form-error').textContent = err.message; }
  });
}

async function deleteSupplier(id, name) {
  if (!confirm(`¿Eliminar al proveedor "${name}"?`)) return;
  try { await api('/suppliers/' + id, { method: 'DELETE' }); toast('Proveedor eliminado'); loadSuppliers(); }
  catch (err) { toast(err.message, 'error'); }
}

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
    const tabs = ['resumen', 'diario', 'resultado', 'balance', 'flujo', 'cuentas'];
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
          const rowClass = isOverdue ? 'style="background:#fef2f2"' : isDueToday ? 'style="background:#fefce8"' : '';
          return `<tr ${rowClass}>
            <td><strong>${esc(f.customer_name)}</strong>${f.phone ? `<br><small style="color:var(--muted)">${esc(f.phone)}</small>` : ''}</td>
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

function openDailyFiadoModal() {
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
        <div class="full"><label>Nombre del cliente *</label><input name="customer_name" required placeholder="Ej: Juan Pérez"></div>
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
