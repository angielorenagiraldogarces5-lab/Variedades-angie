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
