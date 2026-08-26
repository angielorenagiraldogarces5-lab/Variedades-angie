const router = require('express').Router();
const db = require('../database');
require('./database');
const { authenticate } = require('../middleware/auth');
const { checkBlocked, getCreditHistory, getBlockedDays, autoBlock } = require('./utils');

// Listar bloqueados
router.get('/blacklist', authenticate, (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT bl.*, u.full_name AS blocked_by_name
    FROM credit_blacklist bl
    LEFT JOIN users u ON u.id = bl.blocked_by
    WHERE bl.is_blocked = 1
  `;
  const params = [];
  if (search) {
    sql += ' AND (bl.customer_name LIKE ? OR bl.phone LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%');
  }
  sql += ' ORDER BY bl.blocked_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Bloquear manualmente
router.post('/blacklist', authenticate, (req, res) => {
  const { customer_name, phone, reason, notes, customer_id } = req.body || {};
  const name = (customer_name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });

  const existing = checkBlocked(name, customer_id);
  if (existing) return res.status(400).json({ error: 'Este cliente ya está bloqueado' });

  const info = db.prepare(`
    INSERT INTO credit_blacklist (customer_id, customer_name, phone, reason, blocked_by, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(customer_id || null, name, (phone || '').trim(), (reason || '').trim(), req.user.id, (notes || '').trim());

  res.status(201).json({ id: info.lastInsertRowid, message: `Cliente "${name}" bloqueado correctamente` });
});

// Desbloquear
router.delete('/blacklist/:id', authenticate, (req, res) => {
  const info = db.prepare('UPDATE credit_blacklist SET is_blocked = 0 WHERE id = ? AND is_blocked = 1').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Registro no encontrado o ya desbloqueado' });
  res.json({ message: 'Cliente desbloqueado correctamente' });
});

// Verificar si un cliente está bloqueado
router.get('/check/:name', authenticate, (req, res) => {
  const blocked = checkBlocked(req.params.name);
  res.json({ blocked: !!blocked, info: blocked || null });
});

// Historial de crédito
router.get('/history/:name', authenticate, (req, res) => {
  const history = getCreditHistory(req.params.name);
  if (!history) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(history);
});

// Bloqueo automático
router.post('/auto-block', authenticate, (req, res) => {
  const result = autoBlock();
  const msg = result.blocked_count > 0
    ? `${result.blocked_count} cliente(s) bloqueado(s) automáticamente`
    : 'No se encontraron morosos nuevos para bloquear';
  res.json({ message: msg, ...result });
});

// Configuración
router.get('/settings', authenticate, (req, res) => {
  const days = getBlockedDays();
  res.json({ credit_block_days: days });
});

router.put('/settings', authenticate, (req, res) => {
  const days = parseInt(req.body?.credit_block_days);
  if (!days || days < 1 || days > 365) return res.status(400).json({ error: 'Días debe ser un número entre 1 y 365' });
  db.prepare("UPDATE settings SET value = ? WHERE key = 'credit_block_days'").run(String(days));
  res.json({ message: `Configuración actualizada: bloqueo automático a ${days} días`, credit_block_days: days });
});

// Agregar nota de riesgo
router.post('/history/:name/notes', authenticate, (req, res) => {
  const name = (req.params.name || '').trim();
  const { title, description, note_type, severity } = req.body || {};
  if (!title) return res.status(400).json({ error: 'El título es obligatorio' });

  const info = db.prepare(`
    INSERT INTO credit_risk_notes (customer_name, note_type, title, description, severity, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, note_type || 'observation', title.trim(), (description || '').trim(), severity || 'info', req.user.id);

  res.status(201).json({ id: info.lastInsertRowid, message: 'Nota agregada correctamente' });
});

// Eliminar nota de riesgo
router.delete('/history/:name/notes/:id', authenticate, (req, res) => {
  const info = db.prepare('DELETE FROM credit_risk_notes WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Nota no encontrada' });
  res.json({ message: 'Nota eliminada' });
});

module.exports = router;
