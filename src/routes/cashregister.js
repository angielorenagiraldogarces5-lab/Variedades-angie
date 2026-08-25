const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

function recalcTotals(crId) {
  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN type='egreso' THEN amount ELSE 0 END), 0) AS total_expenses
    FROM cash_movements WHERE cash_register_id = ?
  `).get(crId);
  const cr = db.prepare('SELECT initial_amount FROM cash_registers WHERE id = ?').get(crId);
  const expected = cr.initial_amount + sums.total_income - sums.total_expenses;
  db.prepare('UPDATE cash_registers SET total_income = ?, total_expenses = ?, expected_total = ? WHERE id = ?')
    .run(sums.total_income, sums.total_expenses, expected, crId);
  return { ...sums, expected_total: expected };
}

/* Listar cajas */
router.get('/', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM cash_registers ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

/* Caja abierta actual */
router.get('/current', authenticate, (req, res) => {
  const cr = db.prepare("SELECT * FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1").get();
  res.json(cr || null);
});

/* Ver una caja con sus movimientos */
router.get('/:id', authenticate, (req, res) => {
  const cr = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Caja no encontrada' });
  const movements = db.prepare(`
    SELECT cm.*, u.full_name AS user_name
    FROM cash_movements cm
    LEFT JOIN users u ON u.id = cm.user_id
    WHERE cm.cash_register_id = ?
    ORDER BY cm.id
  `).all(cr.id);
  res.json({ ...cr, movements });
});

/* Abrir caja */
router.post('/', authenticate, (req, res) => {
  const openCount = db.prepare("SELECT COUNT(*) AS n FROM cash_registers WHERE status = 'abierta'").get().n;
  if (openCount > 0) return res.status(400).json({ error: 'Ya hay una caja abierta. Cerrala antes de abrir otra.' });

  const initial_amount = Number(req.body?.initial_amount) || 0;
  if (initial_amount < 0) return res.status(400).json({ error: 'El monto inicial no puede ser negativo' });

  const last = db.prepare('SELECT MAX(number) AS n FROM cash_registers').get();
  const number = (last.n || 0) + 1;

  const cashier = req.user.full_name || req.user.username;
  const open_notes = (req.body?.open_notes || '').trim();

  const info = db.prepare('INSERT INTO cash_registers (number, cashier_name, initial_amount, expected_total, open_notes) VALUES (?, ?, ?, ?, ?)')
    .run(number, cashier, initial_amount, initial_amount, open_notes);

  res.status(201).json({ id: info.lastInsertRowid, message: `Caja #${number} abierta`, number });
});

/* Registrar movimiento */
router.post('/:id/movements', authenticate, (req, res) => {
  const cr = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Caja no encontrada' });
  if (cr.status !== 'abierta') return res.status(400).json({ error: 'Solo se pueden registrar movimientos en una caja abierta' });

  const { type, concept } = req.body || {};
  const amount = Number(req.body?.amount) || 0;
  if (!['ingreso', 'egreso'].includes(type)) return res.status(400).json({ error: 'Tipo no válido' });
  if (amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
  if (!concept || !concept.trim()) return res.status(400).json({ error: 'El concepto es obligatorio' });

  db.prepare('INSERT INTO cash_movements (cash_register_id, type, concept, amount, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(cr.id, type, concept.trim(), amount, req.user.id);

  const totals = recalcTotals(cr.id);
  res.status(201).json({ message: `${type === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado`, ...totals });
});

/* Eliminar movimiento */
router.delete('/:id/movements/:mid', authenticate, (req, res) => {
  const cr = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Caja no encontrada' });
  if (cr.status !== 'abierta') return res.status(400).json({ error: 'Solo se pueden eliminar movimientos de una caja abierta' });

  const info = db.prepare('DELETE FROM cash_movements WHERE id = ? AND cash_register_id = ?').run(req.params.mid, cr.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Movimiento no encontrado' });

  const totals = recalcTotals(cr.id);
  res.json({ message: 'Movimiento eliminado', ...totals });
});

/* Cerrar caja (arqueo) */
router.post('/:id/close', authenticate, (req, res) => {
  const cr = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Caja no encontrada' });
  if (cr.status !== 'abierta') return res.status(400).json({ error: 'La caja ya está cerrada' });

  const counted_amount = Number(req.body?.counted_amount);
  if (isNaN(counted_amount) || counted_amount < 0) return res.status(400).json({ error: 'Ingresá el monto contado' });

  const totals = recalcTotals(cr.id);
  const difference = counted_amount - totals.expected_total;

  db.prepare("UPDATE cash_registers SET status = 'cerrada', closed_at = datetime('now','localtime'), counted_amount = ?, difference = ?, close_notes = ?, closed_by = ? WHERE id = ?")
    .run(counted_amount, difference, (req.body?.close_notes || '').trim(), req.user.full_name || req.user.username, cr.id);

  res.json({ message: 'Caja cerrada', ...totals, counted_amount, difference });
});

/* Reabrir caja (admin) */
router.post('/:id/reopen', authenticate, requireAdmin, (req, res) => {
  const cr = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Caja no encontrada' });
  if (cr.status !== 'cerrada') return res.status(400).json({ error: 'La caja no está cerrada' });

  db.prepare("UPDATE cash_registers SET status = 'abierta', closed_at = NULL, counted_amount = NULL, difference = 0, close_notes = '', closed_by = '' WHERE id = ?")
    .run(cr.id);

  res.json({ message: 'Caja reabierta' });
});

/* Eliminar caja (admin) */
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const cr = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Caja no encontrada' });
  if (cr.status === 'abierta') return res.status(400).json({ error: 'No se puede eliminar una caja abierta. Cerrala primero.' });

  db.prepare('DELETE FROM cash_movements WHERE cash_register_id = ?').run(cr.id);
  db.prepare('DELETE FROM cash_registers WHERE id = ?').run(cr.id);
  res.json({ message: 'Caja eliminada' });
});

module.exports = router;
