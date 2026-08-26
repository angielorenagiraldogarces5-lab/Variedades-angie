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
    risk_notes: [],
    totals: { total_fiado: 0, total_pagado: 0, deuda_actual: 0 },
    score: 100,
    blocked: null,
    risk: {
      level: 'bajo',
      decision: 'aprobado',
      factors: [],
      summary: '',
      total_transactions: 0,
      overdue_count: 0,
      on_time_count: 0,
      max_debt: 0,
      avg_payment_days: 0,
      first_debt_date: null,
      last_debt_date: null,
      last_payment_date: null
    }
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

  // Notas de riesgo
  const riskNotes = db.prepare(`
    SELECT rn.*, u.full_name AS author_name FROM credit_risk_notes rn
    LEFT JOIN users u ON u.id = rn.created_by
    WHERE LOWER(TRIM(rn.customer_name)) = LOWER(TRIM(?))
    ORDER BY rn.created_at DESC
  `).all(name);
  result.risk_notes = riskNotes;

  // Totales
  let totalFiado = 0;
  let totalPagado = 0;
  let overdueCount = 0;
  let onTimeCount = 0;
  let maxDebt = 0;
  let firstDate = null;
  let lastDate = null;
  let lastPayDate = null;
  let totalPayDays = 0;
  let payCount = 0;

  const allItems = [...invoices, ...cards, ...daily];

  for (const inv of invoices) {
    const fiado = inv.total || 0;
    const pagado = inv.paid_amount || 0;
    totalFiado += fiado;
    totalPagado += pagado;
    for (const p of inv.payments) {
      totalPagado += p.amount || 0;
      if (p.created_at) { lastPayDate = p.created_at; }
    }
    const saldo = fiado - pagado;
    if (saldo > maxDebt) maxDebt = saldo;
    if (inv.status === 'pendiente') overdueCount++; else onTimeCount++;
    const d = inv.created_at;
    if (d && (!firstDate || d < firstDate)) firstDate = d;
    if (d && (!lastDate || d > lastDate)) lastDate = d;
  }
  for (const card of cards) {
    const fiado = card.amount || 0;
    const pagado = card.paid_amount || 0;
    totalFiado += fiado;
    totalPagado += pagado;
    for (const p of card.payments) {
      totalPagado += p.amount || 0;
      if (p.created_at) { lastPayDate = p.created_at; }
    }
    const saldo = fiado - pagado;
    if (saldo > maxDebt) maxDebt = saldo;
    if (card.status === 'pendiente') overdueCount++; else onTimeCount++;
    const d = card.fiado_date || card.created_at;
    if (d && (!firstDate || d < firstDate)) firstDate = d;
    if (d && (!lastDate || d > lastDate)) lastDate = d;
  }
  for (const df of daily) {
    const fiado = df.amount || 0;
    const pagado = df.paid_amount || 0;
    totalFiado += fiado;
    totalPagado += pagado;
    for (const p of df.payments) {
      totalPagado += p.amount || 0;
      if (p.created_at) { lastPayDate = p.created_at; }
    }
    const saldo = fiado - pagado;
    if (saldo > maxDebt) maxDebt = saldo;
    const isOverdue = df.status === 'pendiente' || df.status === 'vencida';
    if (isOverdue) overdueCount++; else onTimeCount++;
    const d = df.fiado_date || df.created_at;
    if (d && (!firstDate || d < firstDate)) firstDate = d;
    if (d && (!lastDate || d > lastDate)) lastDate = d;
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

  // Análisis de riesgo
  const deuda = result.totals.deuda_actual;
  const totalTx = invoices.length + cards.length + daily.length;
  const factors = [];

  if (overdueCount > 0) {
    factors.push({ label: `${overdueCount} deuda(s) vencida(s)`, type: 'negative', icon: '⏰' });
  }
  if (deuda > 0) {
    factors.push({ label: `Deuda pendiente: ${fmtMoney(deuda)}`, type: 'negative', icon: '💰' });
  }
  if (result.blocked) {
    factors.push({ label: `Bloqueado: ${result.blocked.reason || 'Sin motivo'}`, type: 'critical', icon: '🚫' });
  }
  if (maxDebt > 500000) {
    factors.push({ label: `Máxima deuda alcanzada: ${fmtMoney(maxDebt)}`, type: 'negative', icon: '📈' });
  }
  if (onTimeCount > 0 && overdueCount === 0) {
    factors.push({ label: `${onTimeCount} transacción(es) pagada(s) a tiempo`, type: 'positive', icon: '✅' });
  }
  if (totalTx === 0) {
    factors.push({ label: 'Sin historial crediticio previo', type: 'info', icon: '📋' });
  }
  if (deuda === 0 && totalTx > 0 && !result.blocked) {
    factors.push({ label: 'Todas las deudas saldadas', type: 'positive', icon: '🎉' });
  }
  if (result.score >= 80) {
    factors.push({ label: `Confiabilidad alta (${result.score}%)`, type: 'positive', icon: '⭐' });
  } else if (result.score >= 50) {
    factors.push({ label: `Confiabilidad media (${result.score}%)`, type: 'warning', icon: '⚠️' });
  } else if (result.score < 50 && totalTx > 0) {
    factors.push({ label: `Confiabilidad baja (${result.score}%)`, type: 'negative', icon: '📉' });
  }

  // Determinar nivel de riesgo
  let riskLevel = 'bajo';
  let decision = 'aprobado';
  if (result.blocked || overdueCount >= 3 || (deuda > 0 && result.score < 30)) {
    riskLevel = 'alto';
    decision = 'denegado';
  } else if (overdueCount >= 1 || deuda > 0 || result.score < 60) {
    riskLevel = 'medio';
    decision = 'revision';
  }

  result.risk = {
    level: riskLevel,
    decision,
    factors,
    summary: factors.map(f => f.label).join('. ') || 'Sin datos suficientes para evaluar',
    total_transactions: totalTx,
    overdue_count: overdueCount,
    on_time_count: onTimeCount,
    max_debt: maxDebt,
    first_debt_date: firstDate,
    last_debt_date: lastDate,
    last_payment_date: lastPayDate
  };

  return result;
}

function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-CO');
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
