const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM suppliers WHERE active = 1';
  const params = [];
  if (search) {
    sql += ' AND (name LIKE ? OR document LIKE ? OR phone LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', authenticate, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
  const info = db.prepare('INSERT INTO suppliers (name, document, phone, email, address) VALUES (?, ?, ?, ?, ?)')
    .run(name, (req.body.document || '').trim(), (req.body.phone || '').trim(), (req.body.email || '').trim(), (req.body.address || '').trim());
  res.status(201).json({ id: info.lastInsertRowid, message: 'Proveedor creado' });
});

router.put('/:id', authenticate, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
  const info = db.prepare('UPDATE suppliers SET name = ?, document = ?, phone = ?, email = ?, address = ? WHERE id = ?')
    .run(name, (req.body.document || '').trim(), (req.body.phone || '').trim(), (req.body.email || '').trim(), (req.body.address || '').trim(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json({ message: 'Proveedor actualizado' });
});

router.delete('/:id', authenticate, (req, res) => {
  const info = db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json({ message: 'Proveedor eliminado' });
});

module.exports = router;
