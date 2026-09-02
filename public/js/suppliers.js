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
