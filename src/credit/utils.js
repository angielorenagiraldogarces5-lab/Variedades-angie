const db = require('../database');

function checkBlocked(customerName, customerId) {
  if (customerId) {
    const row = db.prepare('SELECT * FROM credit_blacklist WHERE customer_id = ? AND is_blocked = 1').get(customerId);
    if (row) return row;
  }
  if (customerName && customerName.trim()) {
    const row = db.prepare('SELECT * FROM credit_blacklist WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?)) AND is_blocked = 1').get(customerName.trim());
    if (row) return row;
  }
  return null;
}

function getCreditHistory(customerName) {
  const name = (customerName || '').trim();
  if (!name) return null;

  const result = {
    customer_name: name,
    invoices: [],
    manual_cards: [],
    daily_fiados: [],
    totals: { total_fiado: 0, total_pagado: 0, deuda_actual: 0 },
    score: 100,
    blocked: null
  };

  // Facturas fiadas
  const invoices = db.prepare(`
    SELECT i.*, c.name AS customer_name FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.payment_method = 'fiado'
      AND (LOWER(TRIM(i.client_name)) = LOWER(TRIM(?)) OR LOWER(TRIM(c.name)) = LOWER(TRIM(?)))
    ORDER BY i.created_at DESC
  `).all(name, name);
  result.invoices = invoices;

  // Pagos de facturas
  for (const inv of invoices) {
    const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY created_at').all(inv.id);
    inv.payments = payments;
  }

  // Tarjetas manuales
  const cards = db.prepare(`
    SELECT * FROM fiado_cards
    WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
    ORDER BY created_at DESC
  `).all(name);
  result.manual_cards = cards;

  for (const card of cards) {
    const payments = db.prepare('SELECT * FROM fiado_payments WHERE card_id = ? ORDER BY created_at').all(card.id);
    card.payments = payments;
  }

  // Fiados del día
  const daily = db.prepare(`
    SELECT * FROM daily_fiados
    WHERE LOWER(TRIM(customer_name)) = LOWER(TRIM(?))
    ORDER BY created_at DESC
  `).all(name);
  result.daily_fiados = daily;

  for (const df of daily) {
    const payments = db.prepare('SELECT * FROM daily_fiado_payments WHERE fiado_id = ? ORDER BY created_at').all(df.id);
    df.payments = payments;
  }

  // Totales
  let totalFiado = 0;
  let totalPagado = 0;

  for (const inv of invoices) {
    totalFiado += inv.total || 0;
    totalPagado += inv.paid_amount || 0;
    for (const p of inv.payments) totalPagado += p.amount || 0;
  }
  for (const card of cards) {
    totalFiado += card.amount || 0;
    totalPagado += card.paid_amount || 0;
    for (const p of card.payments) totalPagado += p.amount || 0;
  }
  for (const df of daily) {
    totalFiado += df.amount || 0;
    totalPagado += df.paid_amount || 0;
    for (const p of df.payments) totalPagado += p.amount || 0;
  }

  result.totals = {
    total_fiado: totalFiado,
    total_pagado: totalPagado,
    deuda_actual: Math.max(0, totalFiado - totalPagado)
  };

  // Score: porcentaje pagado
  if (totalFiado > 0) {
    result.score = Math.round((totalPagado / totalFiado) * 100);
  }

  // Verificar si está bloqueado
  result.blocked = checkBlocked(name);

  return result;
}

function getBlockedDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'credit_block_days'").get();
  return parseInt(row?.value) || 90;
}

function autoBlock() {
  const days = getBlockedDays();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const blocked = [];

  // Buscar facturas fiadas vencidas
  const overdueInvoices = db.prepare(`
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM(i.client_name), ''), c.name) AS customer_name,
      COALESCE(NULLIF(TRIM(i.client_phone), ''), c.phone) AS phone,
      i.customer_id
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.payment_method = 'fiado' AND i.status = 'pendiente'
      AND date(i.created_at) <= date(?)
  `).all(cutoffStr);

  for (const row of overdueInvoices) {
    if (!row.customer_name) continue;
    const existing = checkBlocked(row.customer_name, row.customer_id);
    if (!existing) {
      const info = db.prepare(`
        INSERT INTO credit_blacklist (customer_id, customer_name, phone, reason, auto_blocked)
        VALUES (?, ?, ?, ?, 1)
      `).run(row.customer_id, row.customer_name, row.phone || '', `Deuda vencida +${days} días (factura fiada)`);
      blocked.push({ id: info.lastInsertRowid, customer_name: row.customer_name });
    }
  }

  // Buscar tarjetas manuales vencidas
  const overdueCards = db.prepare(`
    SELECT customer_name, phone FROM fiado_cards
    WHERE status = 'pendiente' AND date(fiado_date) <= date(?)
  `).all(cutoffStr);

  for (const row of overdueCards) {
    const existing = checkBlocked(row.customer_name);
    if (!existing) {
      const info = db.prepare(`
        INSERT INTO credit_blacklist (customer_name, phone, reason, auto_blocked)
        VALUES (?, ?, ?, 1)
      `).run(row.customer_name, row.phone || '', `Deuda vencida +${days} días (tarjeta manual)`);
      blocked.push({ id: info.lastInsertRowid, customer_name: row.customer_name });
    }
  }

  // Buscar fiados del día vencidos
  const overdueDaily = db.prepare(`
    SELECT customer_name, phone FROM daily_fiados
    WHERE status IN ('pendiente', 'vencida') AND date(due_date) <= date(?)
  `).all(cutoffStr);

  for (const row of overdueDaily) {
    const existing = checkBlocked(row.customer_name);
    if (!existing) {
      const info = db.prepare(`
        INSERT INTO credit_blacklist (customer_name, phone, reason, auto_blocked)
        VALUES (?, ?, ?, 1)
      `).run(row.customer_name, row.phone || '', `Deuda vencida +${days} días (fiado del día)`);
      blocked.push({ id: info.lastInsertRowid, customer_name: row.customer_name });
    }
  }

  return { blocked_count: blocked.length, blocked };
}

module.exports = { checkBlocked, getCreditHistory, getBlockedDays, autoBlock };
