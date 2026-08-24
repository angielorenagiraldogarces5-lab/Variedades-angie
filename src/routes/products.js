const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const BASE_SELECT = `
  SELECT p.*, c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.active = 1
`;

router.get('/', authenticate, (req, res) => {
  const { search, category_id, low_stock } = req.query;
  const clauses = [];
  const params = [];

  if (search) {
    clauses.push('(p.name LIKE ? OR p.code LIKE ? OR p.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category_id) {
    clauses.push('p.category_id = ?');
    params.push(category_id);
  }
  if (low_stock === '1') {
    clauses.push('p.stock <= p.min_stock');
  }
  const sql = BASE_SELECT + (clauses.length ? ' AND ' + clauses.join(' AND ') : '') + ' ORDER BY p.name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', authenticate, (req, res) => {
  const product = db.prepare(BASE_SELECT + ' AND p.id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(product);
});

function validate(body, forUpdate = false) {
  const errors = [];
  if (!forUpdate && !body.name?.trim()) errors.push('El nombre es obligatorio');
  for (const field of ['cost_price', 'sale_price']) {
    const v = Number(body[field]);
    if (body[field] !== undefined && (isNaN(v) || v < 0)) errors.push(`El campo ${field} debe ser un número positivo`);
  }
  for (const field of ['stock', 'min_stock']) {
    const v = Number(body[field]);
    if (body[field] !== undefined && (!Number.isInteger(v) || v < 0)) errors.push(`El campo ${field} debe ser un número entero positivo`);
  }
  return errors;
}

router.post('/', authenticate, (req, res) => {
  const b = req.body || {};
  const errors = validate(b);
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });

  const code = b.code?.trim() || `P${String(Date.now()).slice(-8)}`;
  try {
    const info = db.prepare(`
      INSERT INTO products (code, name, description, category_id, unit, cost_price, sale_price, stock, min_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code, b.name.trim(), b.description?.trim() || '',
      b.category_id || null,
      b.unit?.trim() || 'unidad',
      Number(b.cost_price) || 0,
      Number(b.sale_price) || 0,
      Number.isInteger(Number(b.stock)) ? Number(b.stock) : 0,
      Number(b.min_stock) ?? 5
    );
    res.status(201).json({ id: info.lastInsertRowid, message: 'Producto creado' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ese código de producto ya existe' });
    throw e;
  }
});

router.put('/:id', authenticate, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  const b = req.body || {};
  const errors = validate(b, true);
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });

  try {
    db.prepare(`
      UPDATE products SET
        code = ?, name = ?, description = ?, category_id = ?, unit = ?,
        cost_price = ?, sale_price = ?, stock = ?, min_stock = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      b.code?.trim() || existing.code,
      b.name?.trim() || existing.name,
      b.description !== undefined ? b.description.trim() : existing.description,
      b.category_id !== undefined ? (b.category_id || null) : existing.category_id,
      b.unit?.trim() || existing.unit,
      b.cost_price !== undefined ? Number(b.cost_price) : existing.cost_price,
      b.sale_price !== undefined ? Number(b.sale_price) : existing.sale_price,
      b.stock !== undefined ? Number(b.stock) : existing.stock,
      b.min_stock !== undefined ? Number(b.min_stock) : existing.min_stock,
      req.params.id
    );
    res.json({ message: 'Producto actualizado' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ese código de producto ya existe' });
    throw e;
  }
});

router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare("UPDATE products SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json({ message: 'Producto eliminado' });
});

module.exports = router;
