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
