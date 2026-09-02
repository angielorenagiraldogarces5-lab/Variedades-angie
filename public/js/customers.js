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
