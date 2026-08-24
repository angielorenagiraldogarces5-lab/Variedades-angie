const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];
const EDITABLE_STATUSES = ['pendiente', 'confirmado', 'listo'];

function orderNumber(n) {
  return 'PD-' + String(n).padStart(5, '0');
}

/* Valida y calcula las líneas del pedido.
   - product_id → nombre y precio de venta actuales del producto (sin tocar stock)
   - name + unit_price → artículo escrito a mano */
function parseItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('El pedido debe tener al menos un artículo'), { status: 400 });
  }

  const lines = [];
  let total = 0;

  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw Object.assign(new Error('Todas las cantidades deben ser enteros mayores que cero'), { status: 400 });
    }

    if (item.product_id) {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
      if (!product) throw Object.assign(new Error('Producto no encontrado en el pedido'), { status: 400 });
      const lineTotal = Math.round(product.sale_price * qty);
      total += lineTotal;
      lines.push({ product, qty, lineTotal });
    } else {
      const name = String(item.name || '').trim();
      if (!name) throw Object.assign(new Error('Cada artículo escrito a mano necesita un nombre'), { status: 400 });
      const price = Number(item.unit_price);
      if (!Number.isFinite(price) || price < 0) {
        throw Object.assign(new Error('Precio no válido para "' + name + '"'), { status: 400 });
      }
      const lineTotal = Math.round(price * qty);
      total += lineTotal;
      lines.push({ free: { name: name.slice(0, 120), price }, qty, lineTotal });
    }
  }

  if (total <= 0) {
    throw Object.assign(new Error('El total estimado del pedido debe ser mayor que cero'), { status: 400 });
  }
  return { lines, total };
}

/* Listar pedidos */
router.get('/', authenticate, (req, res) => {
  const { status, search } = req.query;
  const clauses = [];
  const params = [];

  if (status) { clauses.push('o.status = ?'); params.push(status); }
  else { clauses.push("o.status != 'cancelado'"); }
  if (search) {
    clauses.push('(o.client_name LIKE ? OR o.client_phone LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%');
  }

  const orders = db.prepare(`
    SELECT o.*, c.name AS customer_name,
      u.full_name AS user_name, s.full_name AS seller_name,
      inv.number AS invoice_number,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
      (SELECT oi.name FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 1) AS first_item
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    JOIN users u ON u.id = o.user_id
    LEFT JOIN users s ON s.id = COALESCE(o.seller_user_id, o.user_id)
    LEFT JOIN invoices inv ON inv.id = o.invoice_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY CASE o.status WHEN 'entregado' THEN 1 ELSE 0 END, o.id DESC
    LIMIT 300
  `).all(...params);

  res.json(orders);
});

/* Ver un pedido con sus artículos */
router.get('/:id', authenticate, (req, res) => {
  const order = db.prepare(`
    SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
      u.full_name AS user_name, s.full_name AS seller_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    JOIN users u ON u.id = o.user_id
    LEFT JOIN users s ON s.id = COALESCE(o.seller_user_id, o.user_id)
    WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  res.json({ ...order, items });
});

/* Inserta las líneas de un pedido ya validadas */
function insertLines(orderId, lines) {
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, code, name, unit_price, quantity, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of lines) {
    if (l.product) insertItem.run(orderId, l.product.id, l.product.code || '', l.product.name, l.product.sale_price, l.qty, l.lineTotal);
    else insertItem.run(orderId, null, '', l.free.name, l.free.price, l.qty, l.lineTotal);
  }
}

/* Tomar un pedido nuevo */
router.post('/', authenticate, (req, res) => {
  const b = req.body || {};

  db.exec('BEGIN IMMEDIATE');
  try {
    const { lines, total } = parseItems(b.items);

    let sellerId = req.user.id;
    if (b.seller_user_id) {
      const seller = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(b.seller_user_id);
      if (!seller) throw Object.assign(new Error('El vendedor indicado no existe o está inactivo'), { status: 400 });
      sellerId = seller.id;
    }
    let customerId = b.customer_id || null;
    if (customerId) {
      const cust = db.prepare('SELECT id FROM customers WHERE id = ? AND active = 1').get(customerId);
      if (!cust) throw Object.assign(new Error('El cliente indicado no existe o está inactivo'), { status: 400 });
    }

    const nextNumber = (db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM orders').get().n) + 1;
    const info = db.prepare(`
      INSERT INTO orders (number, customer_id, user_id, seller_user_id, client_name, client_phone, client_address, delivery_date, notes, status, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)
    `).run(
      nextNumber,
      customerId,
      req.user.id,
      sellerId,
      String(b.client_name || '').trim().slice(0, 80),
      String(b.client_phone || '').trim().slice(0, 40),
      String(b.client_address || '').trim().slice(0, 120),
      b.delivery_date || null,
      String(b.notes || '').trim().slice(0, 300),
      total
    );
    const orderId = Number(info.lastInsertRowid);
    insertLines(orderId, lines);

    db.exec('COMMIT');
    res.status(201).json({
      id: orderId,
      number: nextNumber,
      order_number: orderNumber(nextNumber),
      total,
      message: 'Pedido ' + orderNumber(nextNumber) + ' tomado por ' + total
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al tomar el pedido' });
  }
});

/* Editar datos y artículos del pedido (solo si no fue entregado ni cancelado) */
router.put('/:id', authenticate, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (!EDITABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: 'Este pedido ya fue entregado o cancelado y no se puede editar' });
  }

  const b = req.body || {};
  db.exec('BEGIN IMMEDIATE');
  try {
    const parsed = b.items !== undefined ? parseItems(b.items) : null;

    db.prepare(`
      UPDATE orders SET client_name = ?, client_phone = ?, client_address = ?, delivery_date = ?, notes = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      b.client_name !== undefined ? String(b.client_name).trim().slice(0, 80) : order.client_name,
      b.client_phone !== undefined ? String(b.client_phone).trim().slice(0, 40) : order.client_phone,
      b.client_address !== undefined ? String(b.client_address).trim().slice(0, 120) : order.client_address,
      b.delivery_date !== undefined ? (b.delivery_date || null) : order.delivery_date,
      b.notes !== undefined ? String(b.notes).trim().slice(0, 300) : order.notes,
      order.id
    );

    if (parsed) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
      insertLines(order.id, parsed.lines);
      db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(parsed.total, order.id);
    }

    db.exec('COMMIT');
    res.json({ message: 'Pedido ' + orderNumber(order.number) + ' actualizado' });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al editar el pedido' });
  }
});

/* Cambiar estado: pendiente ↔ confirmado ↔ listo, o cancelar */
router.post('/:id/status', authenticate, (req, res) => {
  const allowed = [...EDITABLE_STATUSES, 'cancelado'];
  const next = req.body?.status;
  if (!allowed.includes(next)) return res.status(400).json({ error: 'Estado no válido' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status === 'entregado') return res.status(400).json({ error: 'Este pedido ya fue entregado' });
  if (order.status === 'cancelado') {
    return res.status(400).json({ error: 'El pedido está cancelado; edítelo para reactivarlo' });
  }

  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(next, order.id);
  res.json({ message: 'Pedido ' + orderNumber(order.number) + ': ' + next });
});

/* Entregar el pedido: genera la factura, descuenta stock y, si el pago es
   fiado, la deuda aparece sola en Cobros (fiados de facturas). */
router.post('/:id/deliver', authenticate, (req, res) => {
  const paymentMethod = req.body?.payment_method;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: 'Forma de pago no válida' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status === 'entregado') return res.status(400).json({ error: 'Este pedido ya fue entregado y facturado' });
  if (order.status === 'cancelado') return res.status(400).json({ error: 'No se puede entregar un pedido cancelado' });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene artículos' });

  /* % de comisión: individual del vendedor o el general de configuración */
  const sellerRow = db.prepare('SELECT commission_rate FROM users WHERE id = ?').get(order.seller_user_id || order.user_id);
  const rateRaw = db.prepare("SELECT value FROM settings WHERE key = 'commission_rate'").get()?.value;
  const rate = Math.min(100, Math.max(0, Number(sellerRow?.commission_rate ?? rateRaw) || 0));

  db.exec('BEGIN IMMEDIATE');
  try {
    let total = 0;
    for (const it of items) {
      if (it.product_id) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
        if (!product || product.active !== 1) {
          throw Object.assign(new Error('El producto "' + it.name + '" ya no existe en el inventario'), { status: 400 });
        }
        if (product.stock < it.quantity) {
          throw Object.assign(
            new Error('Stock insuficiente de "' + it.name + '": hay ' + product.stock + ' y el pedido lleva ' + it.quantity),
            { status: 400 }
          );
        }
      }
      total += Math.round(it.unit_price * it.quantity);
    }
    if (total <= 0) throw Object.assign(new Error('El total del pedido debe ser mayor que cero'), { status: 400 });

    const commissionAmount = Math.round(total * rate / 100);
    const isFiado = paymentMethod === 'fiado';
    const nextInvoice = (db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM invoices').get().n) + 1;

    /* Si el pedido no tiene cliente registrado, se usan los datos escritos a mano */
    let customerId = order.customer_id;
    if (customerId) {
      const cust = db.prepare('SELECT id FROM customers WHERE id = ?').get(customerId);
      if (!cust) customerId = null;
    }

    const invInfo = db.prepare(`
      INSERT INTO invoices (number, customer_id, user_id, payment_method, status, total, paid_amount, notes, client_name, client_address, client_phone, seller_user_id, commission_rate, commission_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextInvoice,
      customerId,
      order.user_id,
      paymentMethod,
      isFiado ? 'pendiente' : 'pagada',
      total,
      isFiado ? 0 : total,
      'Pedido ' + orderNumber(order.number),
      order.client_name,
      order.client_address,
      order.client_phone,
      order.seller_user_id || order.user_id,
      rate,
      commissionAmount
    );
    const invoiceId = Number(invInfo.lastInsertRowid);

    const insertInvItem = db.prepare(`
      INSERT INTO invoice_items (invoice_id, product_id, code, name, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now','localtime') WHERE id = ?");
    const insertMovement = db.prepare('INSERT INTO movements (product_id, type, quantity, reason, user_id) VALUES (?, ?, ?, ?, ?)');
    const saleTag = 'FV-' + String(nextInvoice).padStart(6, '0');

    for (const it of items) {
      insertInvItem.run(invoiceId, it.product_id, it.code, it.name, it.unit_price, it.quantity, Math.round(it.unit_price * it.quantity));
      if (it.product_id) {
        updateStock.run(it.quantity, it.product_id);
        insertMovement.run(it.product_id, 'salida', -it.quantity, 'Entrega pedido ' + orderNumber(order.number) + ' · ' + saleTag, req.user.id);
      }
    }

    db.prepare("UPDATE orders SET status = 'entregado', invoice_id = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(invoiceId, order.id);

    db.exec('COMMIT');
    res.status(201).json({
      invoice_id: invoiceId,
      invoice_number: saleTag,
      total,
      message: 'Pedido entregado. Factura ' + saleTag + (isFiado ? ' (fiada)' : '') + ' por ' + total
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al entregar el pedido' });
  }
});

/* Eliminar definitivamente (solo administrador) */
router.delete('/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT number, status FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status !== 'cancelado') {
    return res.status(400).json({ error: 'Solo se pueden eliminar pedidos cancelados' });
  }
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ message: 'Pedido ' + orderNumber(order.number) + ' eliminado' });
});

module.exports = router;
