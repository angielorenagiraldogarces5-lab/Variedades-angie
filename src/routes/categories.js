const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const categories = db.prepare(`
    SELECT c.*, COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
    GROUP BY c.id
    ORDER BY c.name
  `).all();
  res.json(categories);
});

router.post('/', authenticate, requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Categoría creada' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    throw e;
  }
});

router.put('/:id', authenticate, requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const info = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ message: 'Categoría actualizada' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    throw e;
  }
});

router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const inUse = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND active = 1').get(req.params.id).n;
  if (inUse > 0) return res.status(400).json({ error: `No se puede eliminar: hay ${inUse} producto(s) usando esta categoría` });
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
  res.json({ message: 'Categoría eliminada' });
});

module.exports = router;
