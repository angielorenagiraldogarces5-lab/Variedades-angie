const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM customers WHERE active = 1';
  const params = [];
  if (search) {
    sql += ' AND (name LIKE ? OR phone LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%');
  }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', authenticate, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  const info = db.prepare('INSERT INTO customers (name, phone, notes) VALUES (?, ?, ?)')
    .run(name, (req.body.phone || '').trim(), (req.body.notes || '').trim());
  res.status(201).json({ id: info.lastInsertRowid, message: 'Cliente creado' });
});

router.put('/:id', authenticate, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  const info = db.prepare('UPDATE customers SET name = ?, phone = ?, notes = ? WHERE id = ?')
    .run(name, (req.body.phone || '').trim(), (req.body.notes || '').trim(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json({ message: 'Cliente actualizado' });
});

router.delete('/:id', authenticate, (req, res) => {
  const info = db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json({ message: 'Cliente eliminado' });
});

module.exports = router;
