const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { checkBlocked } = require('../credit/utils');
const { registerCashIngreso } = require('../cashLib');

const PAYMENT_TYPES = ['semanal', 'quincenal', 'mensual', 'colaborador'];
const METHODS = ['efectivo', 'transferencia', 'otro'];

function invoiceNumber(n) {
  return 'FV-' + String(n).padStart(6, '0');
}

/* ================================================================
   FECHAS DE COBRO AUTOMÁTICAS
   Según la forma de pago se generan las fechas en que hay que ir
   a cobrar, contadas a partir de la fecha del fiado:
   - semanal:   cada 7 días
   - quincenal: cada 15 días
   - mensual:   mismo día de cada mes
   - colaborador: sin fechas fijas
   ================================================================ */
const SCHEDULED_TYPES = ['semanal', 'quincenal', 'mensual'];

function parseLocalDate(s) { return new Date(s + 'T00:00:00'); }

function isoDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function stepDate(iso, type) {
  const d = parseLocalDate(iso);
  if (type === 'semanal') d.setDate(d.getDate() + 7);
  else if (type === 'quincenal') d.setDate(d.getDate() + 15);
  else d.setMonth(d.getMonth() + 1);
  return isoDate(d);
}

/* Valida la fecha del abono: si no viene se usa hoy.
   Nunca acepta fechas futuras. */
function resolvePaymentDate(raw) {
  const today = isoDate(new Date());
  if (raw === undefined || raw === null || String(raw).trim() === '') return { date: today };
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'La fecha del abono no es válida' };
  if (s > today) return { error: 'La fecha del abono no puede ser futura' };
  return { date: s };
}

/* Calcula el calendario de cobros de una tarjeta pendiente.
   Devuelve null si la forma de pago no maneja fechas fijas. */
function buildSchedule(card) {
  if (!SCHEDULED_TYPES.includes(card.payment_type)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(card.fiado_date || '')) return null;

  const today = isoDate(new Date());

  // El primer cobro es un período después del fiado; avanza hasta hoy
  let date = card.fiado_date;
  let n = 0;
  let lastPast = null;
  while (date <= today && n < 600) {
    lastPast = date;
    date = stepDate(date, card.payment_type);
    n++;
  }

  // Próximas 4 fechas para mostrar en la tarjeta
  const upcoming = [];
  for (let i = 0; i < 4 && n < 600; i++) {
    upcoming.push({ number: n + 1, date });
    date = stepDate(date, card.payment_type);
    n++;
  }
  if (!upcoming.length) return null;

  const next = upcoming[0];
  return {
    next_due_date: next.date,
    next_due_number: next.number,
    is_due_today: next.date === today,
    days_late: lastPast ? Math.round((parseLocalDate(today) - parseLocalDate(lastPast)) / 86400000) : 0,
    upcoming
  };
}

/* ================================================================
   RESUMEN GENERAL: tarjetas manuales + fiados automáticos de facturas
   ================================================================ */
router.get('/', authenticate, (req, res) => {
  const { search, status } = req.query;
  const oldOnly = req.query.old === '1';

  /* --- Tarjetas manuales --- */
  const mClauses = [];
  const mParams = [];
  if (search) {
    mClauses.push('(f.customer_name LIKE ? OR f.item_code LIKE ? OR f.item_name LIKE ? OR f.phone LIKE ?)');
    mParams.push('%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%');
  }
  if (status) { mClauses.push('f.status = ?'); mParams.push(status); }
  else { mClauses.push("f.status != 'anulada'"); }
  if (oldOnly) mClauses.push("f.status = 'pendiente' AND f.fiado_date <= date('now','localtime','-90 days')");

  const manual_cards = db.prepare(`
    SELECT f.*,
      u.full_name AS created_by,
      CAST(julianday('now','localtime') - julianday(f.fiado_date) AS INTEGER) AS days_old,
      (SELECT COUNT(*) FROM fiado_payments p WHERE p.card_id = f.id) AS payment_count,
      (SELECT COUNT(*) FROM fiado_card_items x WHERE x.card_id = f.id) AS item_count,
      (SELECT x.name FROM fiado_card_items x WHERE x.card_id = f.id ORDER BY x.id LIMIT 1) AS first_item
    FROM fiado_cards f
    LEFT JOIN users u ON u.id = f.user_id
    ${mClauses.length ? 'WHERE ' + mClauses.join(' AND ') : ''}
    ORDER BY CASE f.status WHEN 'pendiente' THEN 0 ELSE 1 END, f.fiado_date ASC, f.id DESC
    LIMIT 300
  `).all(...mParams);

  // Fechas de cobro automáticas + orden por próximo cobro
  for (const c of manual_cards) c.schedule = c.status === 'pendiente' ? buildSchedule(c) : null;

  // Estado bloqueado de clientes
  const blockedNames = db.prepare("SELECT LOWER(TRIM(customer_name)) AS name FROM credit_blacklist WHERE is_blocked = 1")
    .all().reduce((set, r) => { set.add(r.name); return set; }, new Set());
  for (const c of manual_cards) c.is_blocked = blockedNames.has((c.customer_name || '').trim().toLowerCase());

  manual_cards.sort((a, b) => {
    const pa = a.status === 'pendiente', pb = b.status === 'pendiente';
    if (pa !== pb) return pa ? -1 : 1;
    const ka = pa ? (a.schedule ? a.schedule.next_due_date : '9999-12-31') : a.fiado_date;
    const kb = pb ? (b.schedule ? b.schedule.next_due_date : '9999-12-31') : b.fiado_date;
    return ka < kb ? -1 : ka > kb ? 1 : b.id - a.id;
  });

  /* --- Tarjetas automáticas (clientes con facturas fiadas pendientes) --- */
  const cClauses = ["i.status = 'pendiente'", 'c.active = 1'];
  const cParams = [];
  if (search) {
    cClauses.push('(c.name LIKE ? OR c.phone LIKE ?)');
    cParams.push('%' + search + '%', '%' + search + '%');
  }
  const cHaving = oldOnly ? 'HAVING MIN(date(i.created_at)) <= date(\'now\',\'localtime\',\'-90 days\')' : '';

  const customer_cards = db.prepare(`
    SELECT c.id, c.name, c.phone,
      COUNT(i.id) AS pending_count,
      SUM(i.total - i.paid_amount) AS debt_total,
      MIN(date(i.created_at)) AS oldest_date,
      CAST(julianday('now','localtime') - julianday(MIN(date(i.created_at))) AS INTEGER) AS oldest_days
    FROM customers c
    JOIN invoices i ON i.customer_id = c.id AND i.status = 'pendiente'
    WHERE ${cClauses.join(' AND ')}
    GROUP BY c.id
    ${cHaving}
    ORDER BY debt_total DESC
  `).all(...cParams);

  /* --- Totales --- */
  const month = "strftime('%Y-%m','now','localtime')";
  const manualDebt = db.prepare(
    "SELECT COALESCE(SUM(amount - paid_amount), 0) AS d FROM fiado_cards WHERE status = 'pendiente'"
  ).get().d;
  const invoiceDebt = db.prepare(`
    SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS d
    FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.active = 1
    WHERE i.status = 'pendiente'
  `).get().d;
  const collectedManual = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM fiado_payments WHERE strftime('%Y-%m', COALESCE(payment_date, substr(created_at, 1, 10))) = ${month}`
  ).get().s;
  const collectedInvoices = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE strftime('%Y-%m', COALESCE(payment_date, substr(created_at, 1, 10))) = ${month}`
  ).get().s;

  /* Deudas antiguas: fiados pendientes con más de 90 días */
  const manualOld = db.prepare(
    "SELECT COALESCE(SUM(amount - paid_amount), 0) AS d FROM fiado_cards WHERE status = 'pendiente' AND fiado_date <= date('now','localtime','-90 days')"
  ).get().d;
  const invoiceOld = db.prepare(`
    SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS d
    FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.active = 1
    WHERE i.status = 'pendiente' AND date(i.created_at) <= date('now','localtime','-90 days')
  `).get().d;

  res.json({
    manual_cards,
    customer_cards,
    totals: {
      total_debt: manualDebt + invoiceDebt,
      manual_debt: manualDebt,
      invoice_debt: invoiceDebt,
      collected_month: collectedManual + collectedInvoices,
      old_debt: manualOld + invoiceOld
    }
  });
});

/* ================================================================
   TARJETAS MANUALES
   ================================================================ */
function validateCardCommon(b) {
  const customerName = (b.customer_name || '').trim();
  const fiadoDate = (b.fiado_date || '').trim();

  if (!customerName) return { error: 'El nombre del cliente es obligatorio' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fiadoDate)) return { error: 'La fecha del fiado no es válida' };
  if (!PAYMENT_TYPES.includes(b.payment_type)) return { error: 'La forma de pago no es válida' };

  return {
    customerName, fiadoDate,
    phone: (b.phone || '').trim(),
    city: (b.city || '').trim(),
    address: (b.address || '').trim(),
    itemCode: (b.item_code || '').trim(),
    itemName: (b.item_name || '').trim(),
    paymentType: b.payment_type,
    notes: (b.notes || '').trim()
  };
}

/* Valida cliente + monto total (tarjeta sin desglose de artículos) */
function validateCardBody(b, paidAmount = 0) {
  const common = validateCardCommon(b);
  if (common.error) return common;

  const amount = Math.round(Number(b.amount));
  if (!Number.isInteger(amount) || amount <= paidAmount) {
    return { error: paidAmount > 0
      ? 'El valor debe ser mayor a lo ya abonado ($' + paidAmount + ')'
      : 'El valor a cobrar debe ser mayor que cero' };
  }
  return { ...common, amount };
}

/* Valida el desglose de artículos de una tarjeta.
   Devuelve { items, amount } o { error }. */
function parseCardItems(rawItems) {
  if (!Array.isArray(rawItems)) return { error: 'Los artículos no son válidos' };
  const items = [];
  let amount = 0;

  for (const it of rawItems) {
    const name = String(it?.name || '').trim();
    if (!name) return { error: 'Cada artículo de la tarjeta necesita un nombre' };

    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty <= 0) return { error: `Cantidad no válida en "${name}"` };

    const price = Number(it.unit_price);
    if (!Number.isFinite(price) || price < 0) return { error: `Precio no válido en "${name}"` };

    const lineTotal = Math.round(price * qty);
    if (lineTotal <= 0) return { error: `El valor de "${name}" debe ser mayor que cero` };

    amount += lineTotal;
    items.push({ code: String(it.code || '').trim().slice(0, 40), name: name.slice(0, 120), qty, price, lineTotal });
  }

  if (!items.length) return { error: 'Agrega al menos un artículo a la tarjeta' };
  return { items, amount };
}

/* Crea la tarjeta. Si viene "items" (desglose), el total es la suma de
   esos artículos; si no, se usa "amount" directo (tarjeta sin desglose). */
router.post('/cards', authenticate, (req, res) => {
  const body = req.body || {};
  const hasItems = Array.isArray(body.items) && body.items.length > 0;

  let v, parsed = null;
  if (hasItems) {
    v = validateCardCommon(body);
    if (v.error) return res.status(400).json({ error: v.error });
    parsed = parseCardItems(body.items);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
  } else {
    v = validateCardBody(body);
    if (v.error) return res.status(400).json({ error: v.error });
  }

  const blockedInfo = checkBlocked(v.customerName);
  if (blockedInfo) {
    return res.status(403).json({
      error: `Cliente bloqueado: ${blockedInfo.reason || 'Sin motivo'}. No se puede crear tarjetas. Desbloquealo desde Estudio Crediticio.`,
      blocked: true,
      blocked_info: blockedInfo
    });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const amount = hasItems ? parsed.amount : v.amount;
    const info = db.prepare(`
      INSERT INTO fiado_cards (customer_name, phone, city, address, item_code, item_name, payment_type, fiado_date, amount, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(v.customerName, v.phone, v.city, v.address,
      hasItems ? '' : v.itemCode, hasItems ? '' : v.itemName,
      v.paymentType, v.fiadoDate, amount, v.notes, req.user.id);

    const cardId = Number(info.lastInsertRowid);
    if (hasItems) {
      const insertItem = db.prepare(
        'INSERT INTO fiado_card_items (card_id, code, name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const it of parsed.items) insertItem.run(cardId, it.code, it.name, it.qty, it.price, it.lineTotal);
    }

    db.exec('COMMIT');
    res.status(201).json({ id: cardId, message: 'Tarjeta de cobro creada por $' + amount });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al crear la tarjeta' });
  }
});

router.get('/cards/:id', authenticate, (req, res) => {
  const card = db.prepare(`
    SELECT f.*, u.full_name AS created_by
    FROM fiado_cards f LEFT JOIN users u ON u.id = f.user_id
    WHERE f.id = ?
  `).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });

  const payments = db.prepare(`
    SELECT p.*, u.full_name AS user_name
    FROM fiado_payments p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.card_id = ?
    ORDER BY COALESCE(p.payment_date, substr(p.created_at, 1, 10)) DESC, p.id DESC
  `).all(card.id);

  const items = db.prepare('SELECT * FROM fiado_card_items WHERE card_id = ? ORDER BY id').all(card.id);

  res.json({
    ...card,
    balance: card.amount - card.paid_amount,
    items,
    payments,
    schedule: buildSchedule(card)
  });
});

/* ================================================================
   AGREGAR ARTÍCULOS A UNA TARJETA YA HECHA
   El cliente pide más cosas después de creada la tarjeta: se suman
   los artículos y sube el total de la tarjeta (los abonos previos
   se conservan).
   ================================================================ */
router.post('/cards/:id/items', authenticate, (req, res) => {
  const card = db.prepare('SELECT * FROM fiado_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });
  if (card.status !== 'pendiente') {
    return res.status(400).json({ error: 'Solo se pueden agregar artículos a tarjetas pendientes' });
  }

  const parsed = parseCardItems(req.body?.items);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  db.exec('BEGIN IMMEDIATE');
  try {
    const insertItem = db.prepare(
      'INSERT INTO fiado_card_items (card_id, code, name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const it of parsed.items) insertItem.run(card.id, it.code, it.name, it.qty, it.price, it.lineTotal);

    db.prepare('UPDATE fiado_cards SET amount = amount + ? WHERE id = ?').run(parsed.amount, card.id);

    db.exec('COMMIT');
    res.json({
      message: `Se agregaron ${parsed.items.length} artículo(s) por $${parsed.amount}. Nuevo total: $${card.amount + parsed.amount}`
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al agregar los artículos' });
  }
});

router.put('/cards/:id', authenticate, (req, res) => {
  const card = db.prepare('SELECT * FROM fiado_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });

  const body = req.body || {};
  const hasItems = Array.isArray(body.items) && body.items.length > 0;

  let v, parsed = null;
  if (hasItems) {
    v = validateCardCommon(body);
    if (v.error) return res.status(400).json({ error: v.error });
    parsed = parseCardItems(body.items);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.amount <= card.paid_amount) {
      return res.status(400).json({ error: 'El total de los artículos ($' + parsed.amount + ') debe ser mayor a lo ya abonado ($' + card.paid_amount + ')' });
    }
  } else {
    v = validateCardBody(body, card.paid_amount);
    if (v.error) return res.status(400).json({ error: v.error });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (hasItems) {
      db.prepare(`
        UPDATE fiado_cards SET customer_name = ?, phone = ?, city = ?, address = ?, item_code = '', item_name = '',
          payment_type = ?, fiado_date = ?, amount = ?, notes = ?
        WHERE id = ?
      `).run(v.customerName, v.phone, v.city, v.address, v.paymentType, v.fiadoDate, parsed.amount, v.notes, card.id);

      db.prepare('DELETE FROM fiado_card_items WHERE card_id = ?').run(card.id);
      const insertItem = db.prepare(
        'INSERT INTO fiado_card_items (card_id, code, name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const it of parsed.items) insertItem.run(card.id, it.code, it.name, it.qty, it.price, it.lineTotal);
    } else {
      db.prepare(`
        UPDATE fiado_cards SET customer_name = ?, phone = ?, city = ?, address = ?, item_code = ?, item_name = ?,
          payment_type = ?, fiado_date = ?, amount = ?, notes = ?
        WHERE id = ?
      `).run(v.customerName, v.phone, v.city, v.address, v.itemCode, v.itemName, v.paymentType, v.fiadoDate, v.amount, v.notes, card.id);
    }

    db.exec('COMMIT');
    res.json({ message: 'Tarjeta actualizada' });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al actualizar la tarjeta' });
  }
});

/* Registrar abono en tarjeta manual */
router.post('/cards/:id/payments', authenticate, (req, res) => {
  const card = db.prepare('SELECT * FROM fiado_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Tarjeta no encontrada' });
  if (card.status !== 'pendiente') return res.status(400).json({ error: 'Esta tarjeta ya está saldada o anulada' });

  const amount = Math.round(Number(req.body?.amount));
  const method = METHODS.includes(req.body?.method) ? req.body.method : 'efectivo';
  const notes = (req.body?.notes || '').trim();
  const pd = resolvePaymentDate(req.body?.payment_date);
  if (pd.error) return res.status(400).json({ error: pd.error });
  const balance = card.amount - card.paid_amount;

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'El monto del abono debe ser mayor que cero' });
  }
  if (amount > balance) {
    return res.status(400).json({ error: 'El monto supera el saldo pendiente ($' + balance + ')' });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const payInfo = db.prepare('INSERT INTO fiado_payments (card_id, amount, method, notes, user_id, payment_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(card.id, amount, method, notes, req.user.id, pd.date);
    registerCashIngreso(db, amount, `Abono tarjeta — ${card.customer_name}`, req.user.id, 'fiado_pago', Number(payInfo.lastInsertRowid));

    const newPaid = card.paid_amount + amount;
    if (newPaid >= card.amount) {
      db.prepare("UPDATE fiado_cards SET paid_amount = ?, status = 'pagada', paid_at = datetime('now','localtime') WHERE id = ?")
        .run(newPaid, card.id);
    } else {
      db.prepare('UPDATE fiado_cards SET paid_amount = ? WHERE id = ?').run(newPaid, card.id);
    }

    db.exec('COMMIT');
    const fullyPaid = newPaid >= card.amount;
    res.json({
      message: fullyPaid
        ? `¡Tarjeta saldada! ${card.customer_name} terminó de pagar`
        : `Abono de $${amount} registrado. Saldo: $${card.amount - newPaid}`
    });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al registrar el abono' });
  }
});

router.post('/cards/:id/void', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare("UPDATE fiado_cards SET status = 'anulada' WHERE id = ? AND status = 'pendiente'").run(req.params.id);
  if (info.changes === 0) return res.status(400).json({ error: 'Solo se pueden anular tarjetas pendientes' });
  res.json({ message: 'Tarjeta anulada' });
});

router.post('/cards/:id/reactivate', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare("UPDATE fiado_cards SET status = 'pendiente' WHERE id = ? AND status = 'anulada'").run(req.params.id);
  if (info.changes === 0) return res.status(400).json({ error: 'Solo se pueden reactivar tarjetas anuladas' });
  res.json({ message: 'Tarjeta reactivada' });
});

router.delete('/cards/:id', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM fiado_cards WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Tarjeta no encontrada' });
  res.json({ message: 'Tarjeta eliminada' });
});

/* Verificar estado crediticio de un cliente (para mostrar en tarjetas) */
router.get('/credit-check/:name', authenticate, (req, res) => {
  const { checkBlocked, getCreditHistory } = require('../credit/utils');
  const name = (req.params.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });

  const blocked = checkBlocked(name);
  let history = null;
  try { history = getCreditHistory(name); } catch {}

  res.json({
    blocked: !!blocked,
    blocked_info: blocked || null,
    score: history?.score ?? null,
    risk_level: history?.risk?.level ?? null,
    deuda_actual: history?.totals?.deuda_actual ?? 0,
    total_transactions: history?.risk?.total_transactions ?? 0,
    overdue_count: history?.risk?.overdue_count ?? 0
  });
});

/* ================================================================
   FIADOS AUTOMÁTICOS (de las facturas con pago "fiado")
   ================================================================ */

/* Detalle de la tarjeta de un cliente */
router.get('/customers/:customerId', authenticate, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.customerId);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

  const invoices = db.prepare(`
    SELECT i.*, u.full_name AS user_name, s.full_name AS seller_name, (i.total - i.paid_amount) AS balance
    FROM invoices i
    JOIN users u ON u.id = i.user_id
    LEFT JOIN users s ON s.id = COALESCE(i.seller_user_id, i.user_id)
    WHERE i.customer_id = ? AND i.status = 'pendiente'
    ORDER BY i.number ASC
  `).all(customer.id);

  const payments = db.prepare(`
    SELECT p.*, u.full_name AS user_name
    FROM invoice_payments p JOIN users u ON u.id = p.user_id
    WHERE p.customer_id = ?
    ORDER BY COALESCE(p.payment_date, substr(p.created_at, 1, 10)) DESC, p.id DESC LIMIT 50
  `).all(customer.id);

  res.json({
    customer,
    invoices,
    payments,
    debt_total: invoices.reduce((a, i) => a + (i.total - i.paid_amount), 0)
  });
});

/* Registrar abono. Si viene invoice_id se aplica solo a esa factura,
   si no se reparte entre las más antiguas primero. */
router.post('/customers/:customerId/payments', authenticate, (req, res) => {
  const amount = Math.round(Number(req.body?.amount));
  const method = METHODS.includes(req.body?.method) ? req.body.method : 'efectivo';
  const notes = (req.body?.notes || '').trim();
  const invoiceId = req.body?.invoice_id ? Number(req.body.invoice_id) : null;
  const pd = resolvePaymentDate(req.body?.payment_date);
  if (pd.error) return res.status(400).json({ error: pd.error });

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'El monto del abono debe ser mayor que cero' });
  }

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.customerId);
  if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

  db.exec('BEGIN IMMEDIATE');
  try {
    let pending;
    if (invoiceId) {
      pending = db.prepare("SELECT * FROM invoices WHERE id = ? AND customer_id = ? AND status = 'pendiente'")
        .all(invoiceId, customer.id);
      if (!pending.length) throw Object.assign(new Error('Esa factura no está pendiente para este cliente'), { status: 400 });
    } else {
      pending = db.prepare("SELECT * FROM invoices WHERE customer_id = ? AND status = 'pendiente' ORDER BY number ASC")
        .all(customer.id);
      if (!pending.length) throw Object.assign(new Error('El cliente no tiene fiados pendientes'), { status: 400 });
    }

    const totalDebt = pending.reduce((a, i) => a + (i.total - i.paid_amount), 0);
    if (amount > totalDebt) {
      throw Object.assign(new Error(`El monto supera la deuda total ($${totalDebt})`), { status: 400 });
    }

    let remaining = amount;
    const touched = [];
    for (const inv of pending) {
      if (remaining <= 0) break;
      const applied = Math.min(inv.total - inv.paid_amount, remaining);
      const newPaid = inv.paid_amount + applied;
      if (newPaid >= inv.total) {
        db.prepare("UPDATE invoices SET paid_amount = ?, status = 'pagada', paid_at = datetime('now','localtime') WHERE id = ?")
          .run(newPaid, inv.id);
      } else {
        db.prepare("UPDATE invoices SET paid_amount = ?, status = 'pendiente' WHERE id = ?").run(newPaid, inv.id);
      }
      touched.push(invoiceNumber(inv.number));
      remaining -= applied;
    }

    const payInfo = db.prepare(`
      INSERT INTO invoice_payments (customer_id, invoice_id, amount, method, notes, user_id, payment_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(customer.id, invoiceId, amount, method, notes || ('Abono a ' + touched.join(', ')), req.user.id, pd.date);

    registerCashIngreso(db, amount, `Abono factura fiada — ${customer.name}`, req.user.id, 'fiado_factura_pago', Number(payInfo.lastInsertRowid));

    db.exec('COMMIT');
    res.json({ message: `Abono de $${amount} registrado para ${customer.name}` });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(e.status || 500).json({ error: e.message || 'Error al registrar el abono' });
  }
});

module.exports = router;
