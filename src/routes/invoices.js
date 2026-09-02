const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { checkBlocked } = require('../credit/utils');
const { registerCashIngreso } = require('../cashLib');

const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];

function invoiceNumber(n) {
  return 'FV-' + String(n).padStart(6, '0');
}

/* Listar facturas */
router.get('/', authenticate, (req, res) => {
  const { status, from, to, seller } = req.query;
  const clauses = [];
  const params = [];

  if (status) { clauses.push('i.status = ?'); params.push(status); }
  if (from) { clauses.push('date(i.created_at) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(i.created_at) <= date(?)'); params.push(to); }
  if (seller) { clauses.push('COALESCE(i.seller_user_id, i.user_id) = ?'); params.push(Number(seller)); }

  const sql = `
    SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS user_name,
      s.full_name AS seller_name,
      (SELECT COUNT(*) FROM invoice_items it WHERE it.invoice_id = i.id) AS item_count
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    JOIN users u ON u.id = i.user_id
    LEFT JOIN users s ON s.id = COALESCE(i.seller_user_id, i.user_id)
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY i.number DESC
    LIMIT 500
  `;
  res.json(db.prepare(sql).all(...params));
});

/* Ver una factura con sus productos */
router.get('/:id', authenticate, (req, res) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS user_name,
      s.full_name AS seller_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    JOIN users u ON u.id = i.user_id
    LEFT JOIN users s ON s.id = COALESCE(i.seller_user_id, i.user_id)
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoice.id);
  res.json({ ...invoice, items });
});

/* Crear una venta (factura).
   Cada item puede ser:
   - { product_id, quantity }            → producto del inventario (descuenta stock)
   - { name, unit_price, quantity }      → artículo escrito a mano (no toca inventario) */
/* Datos del cliente escritos a mano (para facturas sin cliente registrado) */
function parseClientData(b = {}) {
  return {
    name: String(b.client_name || '').trim().slice(0, 80),
    address: String(b.client_address || '').trim().slice(0, 120),
    phone: String(b.client_phone || '').trim().slice(0, 40),
    email: String(b.client_email || '').trim().slice(0, 80)
  };
}

router.post('/', authenticate, (req, res) => {
  const { items, customer_id, payment_method, notes, seller_user_id } = req.body || {};
  const client = parseClientData(req.body);

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La factura debe tener al menos un producto' });
  }
  if (!PAYMENT_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: 'Forma de pago no válida' });
  }

  // Vendedor de la venta: el que se indica o quien factura.
  let sellerId = req.user.id;
  if (seller_user_id) {
    const seller = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(seller_user_id);
    if (!seller) return res.status(400).json({ error: 'El vendedor indicado no existe o está inactivo' });
    sellerId = seller.id;
  }

  // % de comisión: el individual del vendedor o el general de configuración
  const sellerRow = db.prepare('SELECT commission_rate FROM users WHERE id = ?').get(sellerId);
  const rateRaw = db.prepare("SELECT value FROM settings WHERE key = 'commission_rate'").get()?.value;
  const rate = Math.min(100, Math.max(0, Number(sellerRow?.commission_rate ?? rateRaw) || 0));

  db.exec('BEGIN IMMEDIATE');
  try {
    // Validar productos y stock
    const lines = [];
    let total = 0;

    for (const item of items) {
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw Object.assign(new Error('Todas las cantidades deben ser números enteros mayores que cero'), { status: 400 });
      }

      if (item.product_id) {
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
        if (!product) throw Object.assign(new Error('Producto no encontrado en la venta'), { status: 400 });

        if (qty > product.stock) {
          throw Object.assign(
            new Error(`Stock insuficiente de "${product.name}": solo hay ${product.stock} ${product.unit}(s)`),
            { status: 400 }
          );
        }

        const lineTotal = Math.round(product.sale_price * qty);
        total += lineTotal;
        lines.push({ product, qty, lineTotal });
      } else {
        // Artículo escrito a mano
        const name = String(item.name || '').trim();
        if (!name) throw Object.assign(new Error('Cada artículo escrito a mano necesita un nombre'), { status: 400 });
        const price = Number(item.unit_price);
        if (!Number.isFinite(price) || price < 0) {
          throw Object.assign(new Error(`Precio no válido para "${name}"`), { status: 400 });
        }
        const lineTotal = Math.round(price * qty);
        if (lineTotal <= 0) {
          throw Object.assign(new Error(`El valor de "${name}" debe ser mayor que cero`), { status: 400 });
        }
        total += lineTotal;
        lines.push({ free: { name: name.slice(0, 120), price }, qty, lineTotal });
      }
    }

    if (total <= 0) throw Object.assign(new Error('El total de la factura debe ser mayor que cero'), { status: 400 });

    // Verificar bloqueo crediticio si es fiado
    if (isFiado) {
      const clientNameForCheck = client.name || '';
      const customerIdForCheck = customer_id || null;
      const blocked = checkBlocked(clientNameForCheck, customerIdForCheck);
      if (blocked) {
        throw Object.assign(new Error(`Cliente bloqueado: ${blocked.reason || 'Sin motivo'} — No se puede fiar a este cliente`), { status: 403 });
      }
    }

    const commissionAmount = Math.round(total * rate / 100);

    // Número consecutivo dentro de la transacción
    const nextNumber = (db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM invoices').get().n) + 1;
    const isFiado = payment_method === 'fiado';

    const info = db.prepare(`
      INSERT INTO invoices (number, customer_id, user_id, payment_method, status, total, paid_amount, notes, client_name, client_address, client_phone, client_email, seller_user_id, commission_rate, commission_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextNumber,
      customer_id || null,
      req.user.id,
      payment_method,
      isFiado ? 'pendiente' : 'pagada',
      total,
      isFiado ? 0 : total,
      (notes || '').trim(),
      client.name,
      client.address,
      client.phone,
      client.email,
      sellerId,
      rate,
      commissionAmount
    );
    const invoiceId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (invoice_id, product_id, code, name, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStock = db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now','localtime') WHERE id = ?");
    const insertMovement = db.prepare('INSERT INTO movements (product_id, type, quantity, reason, user_id) VALUES (?, ?, ?, ?, ?)');

    for (const l of lines) {
      if (l.product) {
        insertItem.run(invoiceId, l.product.id, l.product.code || '', l.product.name, l.product.sale_price, l.qty, l.lineTotal);
        updateStock.run(l.qty, l.product.id);
        insertMovement.run(l.product.id, 'salida', -l.qty, `Venta ${invoiceNumber(nextNumber)}`, req.user.id);
      } else {
        insertItem.run(invoiceId, null, '', l.free.name, l.free.price, l.qty, l.lineTotal);
      }
    }

    db.exec('COMMIT');
    res.status(201).json({
      id: invoiceId,
      number: nextNumber,
      invoice_number: invoiceNumber(nextNumber),
      total,
      seller_user_id: sellerId,
      commission_rate: rate,
      commission_amount: commissionAmount,
      message: `Factura ${invoiceNumber(nextNumber)} creada por ${total}`
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al crear la factura' });
  }
});

/* Registrar pago de una factura fiada */
router.post('/:id/pay', authenticate, (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
  if (invoice.status !== 'pendiente') return res.status(400).json({ error: 'Esta factura no está pendiente de pago' });

  const cobro = invoice.total - invoice.paid_amount;

  db.exec('BEGIN IMMEDIATE');
  try {
    registerCashIngreso(db, cobro, `Pago factura ${invoiceNumber(invoice.number)}`, req.user.id);
    db.prepare("UPDATE invoices SET status = 'pagada', paid_amount = total, paid_at = datetime('now','localtime') WHERE id = ?")
      .run(invoice.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(e.status || 500).json({ error: e.message || 'Error al registrar el pago' });
  }
  res.json({ message: `Pago de la factura ${invoiceNumber(invoice.number)} registrado` });
});

/* Anular factura (solo admin): devuelve el stock y queda registrada como anulada */
router.post('/:id/void', authenticate, requireAdmin, (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Factura no encontrada' });
  if (invoice.status === 'anulada') return res.status(400).json({ error: 'La factura ya está anulada' });

  db.exec('BEGIN IMMEDIATE');
  try {
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoice.id);

    const updateStock = db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now','localtime') WHERE id = ?");
    const insertMovement = db.prepare('INSERT INTO movements (product_id, type, quantity, reason, user_id) VALUES (?, ?, ?, ?, ?)');

    for (const item of items) {
      if (!item.product_id) continue;
      updateStock.run(item.quantity, item.product_id);
      insertMovement.run(item.product_id, 'entrada', item.quantity, `Anulación ${invoiceNumber(invoice.number)}`, req.user.id);
    }

    db.prepare("UPDATE invoices SET status = 'anulada', paid_amount = 0, paid_at = NULL WHERE id = ?").run(invoice.id);
    db.exec('COMMIT');
    res.json({ message: `Factura ${invoiceNumber(invoice.number)} anulada. El stock fue devuelto.` });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al anular la factura' });
  }
});

/* Limpiar todo el historial de facturas (solo admin).
   Devuelve el stock de los productos y borra todo. */
router.delete('/', authenticate, requireAdmin, (req, res) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const items = db.prepare(`
      SELECT ii.*, i.number FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.product_id IS NOT NULL AND i.status != 'anulada'
    `).all();

    const updateStock = db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now','localtime') WHERE id = ?");
    const insertMovement = db.prepare('INSERT INTO movements (product_id, type, quantity, reason, user_id) VALUES (?, ?, ?, ?, ?)');

    for (const item of items) {
      updateStock.run(item.quantity, item.product_id);
      insertMovement.run(item.product_id, 'entrada', item.quantity, `Limpieza de historial — FV-${String(item.number).padStart(6, '0')}`, req.user.id);
    }

    db.prepare('DELETE FROM invoice_payments').run();
    db.prepare('DELETE FROM invoice_items').run();
    db.prepare('DELETE FROM invoices').run();

    db.exec('COMMIT');
    res.json({ message: 'Historial de facturas eliminado. El stock fue devuelto al inventario.' });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: e.message || 'Error al limpiar el historial' });
  }
});

module.exports = router;
