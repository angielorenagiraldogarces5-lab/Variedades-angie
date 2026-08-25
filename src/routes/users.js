const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

/* Lista de vendedores activos: la usa el punto de venta para elegir
   quién atiende la venta (cualquier usuario autenticado) */
router.get('/sellers', authenticate, (req, res) => {
  const sellers = db.prepare(
    "SELECT id, full_name, role, commission_rate FROM users WHERE active = 1 ORDER BY full_name"
  ).all();
  res.json(sellers);
});

/* Comisiones por colaborador en un rango de fechas (excluye anuladas).
   Cada uno usa su % individual; si no tiene, el % general de configuración.
   Los administradores ven a todos; los colaboradores solo sus propias ventas */
router.get('/commissions', authenticate, (req, res) => {
  const { from, to } = req.query;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fromDate = from || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const toDate = to || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const isAdmin = req.user.role === 'admin';

  const rateRaw = db.prepare("SELECT value FROM settings WHERE key = 'commission_rate'").get()?.value;
  const globalRate = Math.min(100, Math.max(0, Number(rateRaw) || 0));

  const clauses = ['u.active = 1'];
  const params = [globalRate, fromDate, toDate];
  if (!isAdmin) {
    clauses.push('u.id = ?');
    params.push(req.user.id);
  }

  const rows = db.prepare(`
    SELECT u.id, u.username, u.full_name,
      COALESCE(u.commission_rate, ?) AS commission_rate,
      COUNT(i.id) AS invoice_count,
      COALESCE(SUM(CASE WHEN i.status = 'pagada' THEN i.total ELSE 0 END), 0) AS paid_total,
      COALESCE(SUM(CASE WHEN i.status = 'pendiente' THEN i.total ELSE 0 END), 0) AS pending_total,
      COALESCE(SUM(i.total), 0) AS total_sales
    FROM users u
    JOIN invoices i ON COALESCE(i.seller_user_id, i.user_id) = u.id
      AND i.status != 'anulada'
      AND date(i.created_at) >= date(?)
      AND date(i.created_at) <= date(?)
    WHERE ${clauses.join(' AND ')}
    GROUP BY u.id
    ORDER BY total_sales DESC
  `).all(...params);

  res.json({
    from: fromDate,
    to: toDate,
    commission_rate: globalRate,
    is_admin: isAdmin,
    collaborators: rows.map(r => ({
      ...r,
      commission_rate: Math.min(100, Math.max(0, Number(r.commission_rate) || 0)),
      commission: Math.round(r.total_sales * (Math.min(100, Math.max(0, Number(r.commission_rate) || 0))) / 100)
    }))
  });
});

/* Lista básica de usuarios activos (para restablecer contraseñas).
   Accesible a cualquier usuario autenticado */
router.get('/list', authenticate, (req, res) => {
  const users = db.prepare(
    "SELECT id, username, full_name, role FROM users WHERE active = 1 ORDER BY full_name"
  ).all();
  res.json(users);
});

/* Restablecer contraseña de otro usuario.
   Accesible a cualquier usuario autenticado (admin o trabajador) */
router.post('/:id/reset-password', authenticate, (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body || {};
  if (!new_password) return res.status(400).json({ error: 'La nueva contraseña es obligatoria' });
  if (new_password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const user = db.prepare('SELECT id, full_name FROM users WHERE id = ? AND active = 1').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado o inactivo' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), id);
  res.json({ message: `Contraseña de ${user.full_name} restablecida correctamente` });
});

router.use(authenticate, requireAdmin);

router.get('/', (req, res) => {
  const users = db.prepare(
    "SELECT id, username, full_name, role, active, commission_rate, created_at FROM users ORDER BY active DESC, username"
  ).all();
  res.json(users);
});

router.post('/', (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Usuario, contraseña y nombre son obligatorios' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  if (!['admin', 'vendedor'].includes(role)) return res.status(400).json({ error: 'Rol no válido' });

  const commission = parseCommissionRate(req.body?.commission_rate);
  if (commission.error) return res.status(400).json({ error: commission.error });

  try {
    const info = db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role, commission_rate) VALUES (?, ?, ?, ?, ?)"
    ).run(username.trim(), bcrypt.hashSync(password, 10), full_name.trim(), role, commission.value);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Usuario creado' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
    throw e;
  }
});

/* Valida el % de comisión: número entre 0 y 100, o null para usar el general */
function parseCommissionRate(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'La comisión debe ser un porcentaje entre 0 y 100' };
  return { value: n };
}

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { full_name, role, active, password } = req.body || {};

  // Evitar que el admin se bloquee o se quite permisos a sí mismo
  if (user.id === req.user.id && (active === 0 || (role && role !== 'admin'))) {
    return res.status(400).json({ error: 'No puedes desactivarte ni quitarte tu propio rol de administrador' });
  }

  let newCommission = user.commission_rate;
  if (req.body?.commission_rate !== undefined) {
    const c = parseCommissionRate(req.body.commission_rate);
    if (c.error) return res.status(400).json({ error: c.error });
    newCommission = c.value;
  }

  db.prepare("UPDATE users SET full_name = ?, role = ?, active = ?, commission_rate = ? WHERE id = ?")
    .run(
      full_name ?? user.full_name,
      role ?? user.role,
      active === undefined ? user.active : (active ? 1 : 0),
      newCommission,
      id
    );

  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  res.json({ message: 'Usuario actualizado' });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  const info = db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ message: 'Usuario desactivado' });
});

module.exports = router;
