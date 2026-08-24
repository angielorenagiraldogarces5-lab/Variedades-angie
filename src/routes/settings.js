const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const ALLOWED_KEYS = ['store_name', 'nit', 'address', 'phone', 'commission_rate', 'invoice_footer'];

function getSettings() {
  const settings = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    settings[row.key] = row.value;
  }
  return settings;
}

/* Obtener datos del negocio */
router.get('/', authenticate, (req, res) => {
  res.json(getSettings());
});

/* Guardar datos del negocio (solo admin) */
router.put('/', authenticate, requireAdmin, (req, res) => {
  const body = req.body || {};
  const updates = [];

  for (const key of ALLOWED_KEYS) {
    if (key in body) updates.push([key, String(body[key]).trim()]);
  }
  if (!updates.length) return res.status(400).json({ error: 'No hay datos para guardar' });

  if (updates.some(([k, v]) => k === 'store_name' && !v)) {
    return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });
  }
  for (const [key, value] of updates) {
    if (key !== 'commission_rate') continue;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return res.status(400).json({ error: 'La comisión debe ser un número entre 0 y 100' });
    }
  }

  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.exec('BEGIN');
  try {
    for (const [key, value] of updates) upsert.run(key, value);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.json({ message: 'Datos del negocio actualizados', settings: getSettings() });
});

module.exports = router;
