const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const { product_id, type, from, to } = req.query;
  const clauses = [];
  const params = [];

  if (product_id) { clauses.push('m.product_id = ?'); params.push(product_id); }
  if (type) { clauses.push('m.type = ?'); params.push(type); }
  if (from) { clauses.push('date(m.created_at) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(m.created_at) <= date(?)'); params.push(to); }

  const sql = `
    SELECT m.*, p.name AS product_name, p.code AS product_code, u.full_name AS user_name
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN users u ON u.id = m.user_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY m.id DESC
    LIMIT 500
  `;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', authenticate, (req, res) => {
  const { product_id, type, reason } = req.body || {};
  let { quantity } = req.body || {};

  if (!['entrada', 'salida', 'ajuste'].includes(type)) return res.status(400).json({ error: 'Tipo de movimiento no válido' });

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(product_id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  db.exec('BEGIN IMMEDIATE');
  try {
    let delta;

    if (type === 'ajuste') {
      // En ajustes, "quantity" es el nuevo total físico del inventario
      quantity = Number(quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw Object.assign(new Error('La cantidad debe ser un número entero mayor o igual a cero'), { status: 400 });
      }
      delta = quantity - product.stock;
    } else {
      quantity = Number(quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw Object.assign(new Error('La cantidad debe ser un número entero mayor que cero'), { status: 400 });
      }
      delta = type === 'entrada' ? quantity : -quantity;
    }

    const newStock = product.stock + delta;
    if (newStock < 0) {
      throw Object.assign(
        new Error(`Stock insuficiente: solo hay ${product.stock} ${product.unit}(s) disponibles`),
        { status: 400 }
      );
    }

    db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(newStock, product.id);

    db.prepare('INSERT INTO movements (product_id, type, quantity, reason, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(product.id, type, delta, reason?.trim() || '', req.user.id);

    db.exec('COMMIT');
    res.status(201).json({ message: `Movimiento registrado. Nuevo stock: ${newStock}`, stock: newStock });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al registrar el movimiento' });
  }
});

router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  const movement = db.prepare('SELECT * FROM movements WHERE id = ?').get(req.params.id);
  if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado' });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(movement.product_id);
  if (!product) return res.status(404).json({ error: 'Producto asociado no encontrado' });

  const newStock = product.stock - movement.quantity;
  if (newStock < 0) {
    return res.status(400).json({ error: `No se puede eliminar: el stock quedaría en ${newStock} (negativo)` });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(newStock, product.id);
    db.prepare('DELETE FROM movements WHERE id = ?').run(req.params.id);
    db.exec('COMMIT');
    res.json({ message: `Movimiento eliminado. Stock restaurado: ${newStock}`, stock: newStock });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: 'Error al eliminar el movimiento' });
  }
});

module.exports = router;
