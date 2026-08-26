const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { checkBlocked } = require('../credit/utils');

const PLAZOS = ['diario', '8dias', 'semanal', 'quincenal', 'mensual'];
const METHODS = ['efectivo', 'transferencia', 'otro'];

function parseLocalDate(s) { return new Date(s + 'T00:00:00'); }

function isoDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function today() { return isoDate(new Date()); }

function calcDueDate(fiadoDate, plazo) {
  const d = parseLocalDate(fiadoDate);
  if (plazo === 'diario') d.setDate(d.getDate() + 1);
  else if (plazo === '8dias') d.setDate(d.getDate() + 8);
  else if (plazo === 'semanal') d.setDate(d.getDate() + 7);
  else if (plazo === 'quincenal') d.setDate(d.getDate() + 15);
  else if (plazo === 'mensual') d.setMonth(d.getMonth() + 1);
  return isoDate(d);
}

/* Marcar como vencidos los que pasaron la fecha */
function updateOverdue() {
  db.prepare("UPDATE daily_fiados SET status = 'vencida' WHERE status = 'pendiente' AND due_date < date('now','localtime')").run();
}

/* ================================================================
   LISTAR
   ================================================================ */
router.get('/', authenticate, (req, res) => {
  updateOverdue();
  const { search, status } = req.query;

  const clauses = [];
  const params = [];

  if (search) {
    clauses.push('(customer_name LIKE ? OR description LIKE ? OR phone LIKE ?)');
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  const fiados = db.prepare(`
    SELECT f.*, u.full_name AS created_by,
      (f.amount - f.paid_amount) AS balance
    FROM daily_fiados f
    LEFT JOIN users u ON u.id = f.user_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY
      CASE f.status WHEN 'pendiente' THEN 0 WHEN 'vencida' THEN 1 ELSE 2 END,
      f.due_date ASC, f.id DESC
    LIMIT 500
  `).all(...params);

  // Estado bloqueado de clientes
  const blockedNames = db.prepare("SELECT LOWER(TRIM(customer_name)) AS name FROM credit_blacklist WHERE is_blocked = 1")
    .all().reduce((set, r) => { set.add(r.name); return set; }, new Set());
  for (const f of fiados) f.is_blocked = blockedNames.has((f.customer_name || '').trim().toLowerCase());

  const hoy = today();
  const vencidos = fiados.filter(f => f.status === 'vencida');
  const venceHoy = fiados.filter(f => f.status === 'pendiente' && f.due_date === hoy);
  const pendientes = fiados.filter(f => f.status !== 'pagada');

  const month = "strftime('%Y-%m','now','localtime')";
  const cobradoMes = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM daily_fiado_payments WHERE strftime('%Y-%m', COALESCE(payment_date, substr(created_at, 1, 10))) = ${month}`
  ).get().s;

  res.json({
    fiados,
    stats: {
      vencidos: vencidos.length,
      vencidos_monto: vencidos.reduce((a, f) => a + f.balance, 0),
      vence_hoy: venceHoy.length,
      vence_hoy_monto: venceHoy.reduce((a, f) => a + f.balance, 0),
      pendientes: pendientes.length,
      pendientes_monto: pendientes.reduce((a, f) => a + f.balance, 0),
      cobrado_mes: cobradoMes
    }
  });
});

/* ================================================================
   CREAR
   ================================================================ */
router.post('/', authenticate, (req, res) => {
  const b = req.body || {};
  const customerName = (b.customer_name || '').trim();
  const phone = (b.phone || '').trim();
  const description = (b.description || '').trim();
  const amount = Math.round(Number(b.amount));
  const paymentType = (b.payment_type || '').trim();
  const fiadoDate = (b.fiado_date || '').trim();
  const notes = (b.notes || '').trim();

  if (!customerName) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  if (!description) return res.status(400).json({ error: 'La descripción es obligatoria' });
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor que cero' });
  if (!PLAZOS.includes(paymentType)) return res.status(400).json({ error: 'Plazo no válido' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fiadoDate)) return res.status(400).json({ error: 'La fecha no es válida' });

  const blockedInfo = checkBlocked(customerName);
  if (blockedInfo) {
    return res.status(403).json({
      error: `Cliente bloqueado: ${blockedInfo.reason || 'Sin motivo'}. No se puede crear fiados. Desbloquealo desde Estudio Crediticio.`,
      blocked: true,
      blocked_info: blockedInfo
    });
  }

  const dueDate = calcDueDate(fiadoDate, paymentType);

  const info = db.prepare(`
    INSERT INTO daily_fiados (customer_name, phone, description, amount, payment_type, fiado_date, due_date, notes, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customerName, phone, description, amount, paymentType, fiadoDate, dueDate, notes, req.user.id);

  res.status(201).json({ id: Number(info.lastInsertRowid), message: `Fiado creado por $${amount}, vence el ${dueDate}` });
});

/* Verificar estado crediticio de un cliente */
router.get('/credit-check/:name', authenticate, (req, res) => {
  const { checkBlocked: cb, getCreditHistory } = require('../credit/utils');
  const name = (req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  const blocked = cb(name);
  let history = null;
  try { history = getCreditHistory(name); } catch {}

  res.json({
    blocked: !!blocked,
    blocked_info: blocked || null,
    score: history?.score ?? null,
    risk_level: history?.risk?.level ?? null,
    deuda_actual: history?.totals?.deuda_actual ?? 0,
    total_transactions: history?.risk?.total_transactions ?? 0,
    overdue_count: history?.risk?.overdue_count ?? 0
  });
});

/* ================================================================
   VER DETALLE
   ================================================================ */
router.get('/:id', authenticate, (req, res) => {
  const fiado = db.prepare(`
    SELECT f.*, u.full_name AS created_by, (f.amount - f.paid_amount) AS balance
    FROM daily_fiados f LEFT JOIN users u ON u.id = f.user_id
    WHERE f.id = ?
  `).get(req.params.id);
  if (!fiado) return res.status(404).json({ error: 'Fiado no encontrado' });

  const payments = db.prepare(`
    SELECT p.*, u.full_name AS user_name
    FROM daily_fiado_payments p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.fiado_id = ?
    ORDER BY COALESCE(p.payment_date, substr(p.created_at, 1, 10)) DESC, p.id DESC
  `).all(fiado.id);

  res.json({ ...fiado, payments });
});

/* ================================================================
   REGISTRAR ABONO
   ================================================================ */
router.post('/:id/payments', authenticate, (req, res) => {
  const fiado = db.prepare('SELECT * FROM daily_fiados WHERE id = ?').get(req.params.id);
  if (!fiado) return res.status(404).json({ error: 'Fiado no encontrado' });
  if (fiado.status === 'pagada') return res.status(400).json({ error: 'Este fiado ya está pagado' });

  const amount = Math.round(Number(req.body?.amount));
  const method = METHODS.includes(req.body?.method) ? req.body.method : 'efectivo';
  const notes = (req.body?.notes || '').trim();
  const paymentDate = (req.body?.payment_date || '').trim() || today();

  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor que cero' });
  const balance = fiado.amount - fiado.paid_amount;
  if (amount > balance) return res.status(400).json({ error: `El monto supera el saldo pendiente ($${balance})` });

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO daily_fiado_payments (fiado_id, amount, method, notes, user_id, payment_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fiado.id, amount, method, notes, req.user.id, paymentDate);

    const newPaid = fiado.paid_amount + amount;
    if (newPaid >= fiado.amount) {
      db.prepare("UPDATE daily_fiados SET paid_amount = ?, status = 'pagada' WHERE id = ?").run(newPaid, fiado.id);
    } else {
      db.prepare('UPDATE daily_fiados SET paid_amount = ? WHERE id = ?').run(newPaid, fiado.id);
    }

    db.exec('COMMIT');
    const fullyPaid = newPaid >= fiado.amount;
    res.json({
      message: fullyPaid
        ? `${fiado.customer_name} terminó de pagar!`
        : `Abono de $${amount} registrado. Saldo: $${fiado.amount - newPaid}`
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al registrar el abono' });
  }
});

/* ================================================================
   MARCAR COMO PAGADO
   ================================================================ */
router.post('/:id/mark-paid', authenticate, (req, res) => {
  const fiado = db.prepare('SELECT * FROM daily_fiados WHERE id = ?').get(req.params.id);
  if (!fiado) return res.status(404).json({ error: 'Fiado no encontrado' });
  if (fiado.status === 'pagada') return res.status(400).json({ error: 'Ya está pagado' });

  db.prepare("UPDATE daily_fiados SET paid_amount = amount, status = 'pagada' WHERE id = ?").run(fiado.id);
  res.json({ message: `${fiado.customer_name} marcado como pagado` });
});

/* ================================================================
   ELIMINAR
   ================================================================ */
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM daily_fiados WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Fiado no encontrado' });
  res.json({ message: 'Fiado eliminado' });
});

/* ================================================================
   CLIENTES CON DEUDA
   ================================================================ */
router.get('/stats/clients', authenticate, (req, res) => {
  updateOverdue();
  const clients = db.prepare(`
    SELECT customer_name, phone,
      COUNT(*) AS total_fiados,
      SUM(CASE WHEN status != 'pagada' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status != 'pagada' THEN amount - paid_amount ELSE 0 END) AS total_owed
    FROM daily_fiados
    GROUP BY customer_name
    ORDER BY total_owed DESC
  `).all();

  res.json(clients);
});

module.exports = router;
