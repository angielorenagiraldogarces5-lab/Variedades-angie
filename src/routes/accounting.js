const router = require('express').Router();
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

/* ============ PLAN DE CUENTAS ============ */

/* Listar cuentas */
router.get('/accounts', authenticate, (req, res) => {
  const accounts = db.prepare(`
    SELECT a.*, 
      (SELECT COUNT(*) FROM journal_lines jl WHERE jl.account_id = a.id) AS usage_count
    FROM accounts a ORDER BY a.code
  `).all();
  res.json(accounts);
});

/* Crear cuenta */
router.post('/accounts', authenticate, requireAdmin, (req, res) => {
  const { code, name, type, parent_id } = req.body || {};
  if (!code || !code.trim()) return res.status(400).json({ error: 'El código es obligatorio' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!['activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'].includes(type))
    return res.status(400).json({ error: 'Tipo no válido' });

  try {
    const info = db.prepare('INSERT INTO accounts (code, name, type, parent_id) VALUES (?, ?, ?, ?)')
      .run(code.trim(), name.trim(), type, parent_id || null);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Cuenta creada' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ya existe una cuenta con ese código' });
    throw e;
  }
});

/* Editar cuenta */
router.put('/accounts/:id', authenticate, requireAdmin, (req, res) => {
  const { name, type, parent_id } = req.body || {};
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada' });

  db.prepare('UPDATE accounts SET name = ?, type = ?, parent_id = ? WHERE id = ?')
    .run(name || acc.name, type || acc.type, parent_id !== undefined ? parent_id : acc.parent_id, acc.id);
  res.json({ message: 'Cuenta actualizada' });
});

/* Eliminar cuenta (solo si no tiene movimientos) */
router.delete('/accounts/:id', authenticate, requireAdmin, (req, res) => {
  const usage = db.prepare('SELECT COUNT(*) AS n FROM journal_lines WHERE account_id = ?').get(req.params.id).n;
  if (usage > 0) return res.status(400).json({ error: 'No se puede eliminar: la cuenta tiene movimientos contables' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Cuenta eliminada' });
});

/* ============ ASIENTOS CONTABLES (LIBRO DIARIO) ============ */

/* Listar asientos */
router.get('/journal', authenticate, (req, res) => {
  const { from, to, account_id, search } = req.query;
  let sql = `
    SELECT je.*, u.full_name AS user_name,
      (SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl.entry_id = je.id) AS total_debit,
      (SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl.entry_id = je.id) AS total_credit
    FROM journal_entries je
    LEFT JOIN users u ON u.id = je.user_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { sql += ' AND je.date >= ?'; params.push(from); }
  if (to) { sql += ' AND je.date <= ?'; params.push(to); }
  if (search) { sql += ' AND je.description LIKE ?'; params.push('%' + search + '%'); }
  if (account_id) {
    sql += ' AND je.id IN (SELECT entry_id FROM journal_lines WHERE account_id = ?)';
    params.push(account_id);
  }
  sql += ' ORDER BY je.date DESC, je.id DESC LIMIT 500';

  const entries = db.prepare(sql).all(...params);
  res.json(entries);
});

/* Ver un asiento con sus líneas */
router.get('/journal/:id', authenticate, (req, res) => {
  const entry = db.prepare(`
    SELECT je.*, u.full_name AS user_name
    FROM journal_entries je LEFT JOIN users u ON u.id = je.user_id
    WHERE je.id = ?
  `).get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Asiento no encontrado' });

  const lines = db.prepare(`
    SELECT jl.*, a.code AS account_code, a.name AS account_name, a.type AS account_type
    FROM journal_lines jl
    JOIN accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = ?
    ORDER BY jl.id
  `).all(entry.id);

  res.json({ ...entry, lines });
});

/* Crear asiento manual */
router.post('/journal', authenticate, requireAdmin, (req, res) => {
  const { date, description, lines } = req.body || {};
  if (!date) return res.status(400).json({ error: 'La fecha es obligatoria' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'La descripción es obligatoria' });
  if (!Array.isArray(lines) || lines.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 líneas' });

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    return res.status(400).json({ error: `Los débitos (${totalDebit}) no igualan los créditos (${totalCredit})` });

  for (const l of lines) {
    if (!l.account_id) return res.status(400).json({ error: 'Todas las líneas deben tener una cuenta' });
    if ((Number(l.debit) || 0) < 0 || (Number(l.credit) || 0) < 0)
      return res.status(400).json({ error: 'Los montos no pueden ser negativos' });
    if ((Number(l.debit) || 0) === 0 && (Number(l.credit) || 0) === 0)
      return res.status(400).json({ error: 'Cada línea debe tener débito o crédito mayor a cero' });
  }

  const last = db.prepare('SELECT MAX(number) AS n FROM journal_entries').get();
  const number = (last.n || 0) + 1;

  const insertEntry = db.prepare('INSERT INTO journal_entries (number, date, description, source, user_id) VALUES (?, ?, ?, ?, ?)');
  const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)');

  const info = insertEntry.run(number, date, description.trim(), 'manual', req.user.id);
  const entryId = info.lastInsertRowid;

  for (const l of lines) {
    insertLine.run(entryId, l.account_id, Number(l.debit) || 0, Number(l.credit) || 0, (l.description || '').trim());
  }

  res.status(201).json({ id: entryId, message: `Asiento #${number} registrado` });
});

/* Eliminar asiento manual */
router.delete('/journal/:id', authenticate, requireAdmin, (req, res) => {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Asiento no encontrado' });
  if (entry.source !== 'manual') return res.status(400).json({ error: 'Solo se pueden eliminar asientos manuales' });

  db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(entry.id);
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entry.id);
  res.json({ message: 'Asiento eliminado' });
});

/* ============ GENERACIÓN AUTOMÁTICA DE ASIENTOS ============ */

/* Generar asientos desde facturas pagadas en un rango de fechas */
router.post('/generate-from-invoices', authenticate, requireAdmin, (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'Se requieren fechas desde y hasta' });

  const invoices = db.prepare(`
    SELECT i.*, 
      COALESCE((SELECT SUM(ii.line_total) FROM invoice_items ii WHERE ii.invoice_id = i.id), 0) AS items_total
    FROM invoices i
    WHERE i.status IN ('pagada', 'pendiente')
      AND DATE(i.created_at) >= ? AND DATE(i.created_at) <= ?
      AND i.id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'factura' AND source_id IS NOT NULL)
  `).all(from, to);

  let count = 0;
  const last = db.prepare('SELECT MAX(number) AS n FROM journal_entries').get();
  let num = (last.n || 0) + 1;

  const insertEntry = db.prepare('INSERT INTO journal_entries (number, date, description, source, source_id, user_id) VALUES (?, ?, ?, ?, ?, ?)');
  const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)');

  const accCaja = db.prepare("SELECT id FROM accounts WHERE code = '1101'").get();
  const accCxC = db.prepare("SELECT id FROM accounts WHERE code = '1103'").get();
  const accInv = db.prepare("SELECT id FROM accounts WHERE code = '1104'").get();
  const accVentas = db.prepare("SELECT id FROM accounts WHERE code = '4101'").get();
  const accCMV = db.prepare("SELECT id FROM accounts WHERE code = '5101'").get();

  const tx = db.transaction(() => {
    for (const inv of invoices) {
      const date = inv.created_at ? inv.created_at.slice(0, 10) : from;
      const entryInfo = insertEntry.run(num++, date, `Factura FV-${String(inv.number).padStart(6, '0')} — ${inv.client_name || inv.client_name || 'Mostrador'}`, 'factura', inv.id, inv.user_id);
      const entryId = entryInfo.lastInsertRowid;

      // Débito: Caja o Cuentas por Cobrar
      if (inv.status === 'pagada') {
        insertLine.run(entryId, accCaja.id, inv.total, 0, 'Cobro de factura');
      } else {
        insertLine.run(entryId, accCxC.id, inv.total, 0, 'Factura fiada (pendiente cobro)');
      }
      // Crédito: Ventas
      insertLine.run(entryId, accVentas.id, 0, inv.total, 'Ingreso por venta');

      // Costo de mercadería (si hay costo registrado)
      if (inv.status !== 'anulada') {
        const costItems = db.prepare(`
          SELECT COALESCE(SUM(ii.quantity * COALESCE(
            (SELECT p.cost_price FROM products p WHERE p.id = ii.product_id), 0)
          ), 0) AS total_cost
          FROM invoice_items ii WHERE ii.invoice_id = ?
        `).get(inv.id);

        if (costItems.total_cost > 0) {
          const costEntry = insertEntry.run(num++, date, `CMV Factura FV-${String(inv.number).padStart(6, '0')}`, 'cmv', inv.id, inv.user_id);
          const costEntryId = costEntry.lastInsertRowid;
          insertLine.run(costEntryId, accCMV.id, costItems.total_cost, 0, 'Costo de mercadería vendida');
          insertLine.run(costEntryId, accInv.id, 0, costItems.total_cost, 'Salida de inventario');
        }
      }
      count++;
    }
  });
  tx();

  res.json({ message: `${count} asiento(s) generado(s) desde facturas`, count });
});

/* Generar asientos desde movimientos de caja */
router.post('/generate-from-cash', authenticate, requireAdmin, (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'Se requieren fechas desde y hasta' });

  const movements = db.prepare(`
    SELECT cm.*, cr.number AS register_number
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    WHERE DATE(cm.created_at) >= ? AND DATE(cm.created_at) <= ?
      AND cm.id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'caja' AND source_id IS NOT NULL)
  `).all(from, to);

  let count = 0;
  const last = db.prepare('SELECT MAX(number) AS n FROM journal_entries').get();
  let num = (last.n || 0) + 1;

  const insertEntry = db.prepare('INSERT INTO journal_entries (number, date, description, source, source_id, user_id) VALUES (?, ?, ?, ?, ?, ?)');
  const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)');

  const accCaja = db.prepare("SELECT id FROM accounts WHERE code = '1101'").get();
  const accIngresos = db.prepare("SELECT id FROM accounts WHERE code = '4102'").get();
  const accGastos = db.prepare("SELECT id FROM accounts WHERE code = '5206'").get();
  const accComisiones = db.prepare("SELECT id FROM accounts WHERE code = '5205'").get();

  const tx = db.transaction(() => {
    for (const m of movements) {
      const date = m.created_at ? m.created_at.slice(0, 10) : from;
      const entryInfo = insertEntry.run(num++, date, `Caja #${m.register_number} — ${m.concept} (${m.type})`, 'caja', m.id, m.user_id);
      const entryId = entryInfo.lastInsertRowid;

      if (m.type === 'ingreso') {
        insertLine.run(entryId, accCaja.id, m.amount, 0, `Ingreso: ${m.concept}`);
        // Clasificar ingreso según concepto
        let targetAcc = accIngresos.id;
        if (m.concept.toLowerCase().includes('fiado') || m.concept.toLowerCase().includes('abono')) {
          // Abono de fiado: reducir cuentas por cobrar
          targetAcc = db.prepare("SELECT id FROM accounts WHERE code = '1103'").get().id;
          insertLine.run(entryId, targetAcc, 0, m.amount, `Abono de cliente: ${m.concept}`);
        } else {
          insertLine.run(entryId, targetAcc, 0, m.amount, `Ingreso por: ${m.concept}`);
        }
      } else {
        insertLine.run(entryId, accGastos.id, m.amount, 0, `Egreso: ${m.concept}`);
        insertLine.run(entryId, accCaja.id, 0, m.amount, `Salida: ${m.concept}`);
      }
      count++;
    }
  });
  tx();

  res.json({ message: `${count} asiento(s) generado(s) desde caja`, count });
});

/* Generar asientos desde pagos de fiados */
router.post('/generate-from-collections', authenticate, requireAdmin, (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'Se requieren fechas desde y hasta' });

  // Pagos de tarjetas manuales
  const cardPayments = db.prepare(`
    SELECT fp.*, fc.customer_name, fc.id AS card_id
    FROM fiado_payments fp
    JOIN fiado_cards fc ON fc.id = fp.card_id
    WHERE DATE(fp.created_at) >= ? AND DATE(fp.created_at) <= ?
      AND fp.id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'fiado_pago' AND source_id IS NOT NULL)
  `).all(from, to);

  // Pagos de fiados de facturas
  const invPayments = db.prepare(`
    SELECT ip.*, c.name AS customer_name
    FROM invoice_payments ip
    LEFT JOIN customers c ON c.id = ip.customer_id
    WHERE DATE(ip.created_at) >= ? AND DATE(ip.created_at) <= ?
      AND ip.id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'fiado_factura_pago' AND source_id IS NOT NULL)
  `).all(from, to);

  // Pagos de fiados del día
  const dfPayments = db.prepare(`
    SELECT dfp.*, df.customer_name
    FROM daily_fiado_payments dfp
    JOIN daily_fiados df ON df.id = dfp.fiado_id
    WHERE DATE(dfp.created_at) >= ? AND DATE(dfp.created_at) <= ?
      AND dfp.id NOT IN (SELECT source_id FROM journal_entries WHERE source = 'fiado_dia_pago' AND source_id IS NOT NULL)
  `).all(from, to);

  let count = 0;
  const last = db.prepare('SELECT MAX(number) AS n FROM journal_entries').get();
  let num = (last.n || 0) + 1;

  const insertEntry = db.prepare('INSERT INTO journal_entries (number, date, description, source, source_id, user_id) VALUES (?, ?, ?, ?, ?, ?)');
  const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit, description) VALUES (?, ?, ?, ?, ?)');

  const accCaja = db.prepare("SELECT id FROM accounts WHERE code = '1101'").get();
  const accCxC = db.prepare("SELECT id FROM accounts WHERE code = '1103'").get();

  const tx = db.transaction(() => {
    for (const p of cardPayments) {
      const date = p.created_at ? p.created_at.slice(0, 10) : from;
      const entryInfo = insertEntry.run(num++, date, `Abono fiado — ${p.customer_name} (tarjeta #${p.card_id})`, 'fiado_pago', p.id, p.user_id);
      const entryId = entryInfo.lastInsertRowid;
      insertLine.run(entryId, accCaja.id, p.amount, 0, `Cobro de fiado: ${p.customer_name}`);
      insertLine.run(entryId, accCxC.id, 0, p.amount, `Reducción CxC: ${p.customer_name}`);
      count++;
    }

    for (const p of invPayments) {
      const date = p.created_at ? p.created_at.slice(0, 10) : from;
      const entryInfo = insertEntry.run(num++, date, `Abono fiado factura — ${p.customer_name || 'Cliente'}`, 'fiado_factura_pago', p.id, p.user_id);
      const entryId = entryInfo.lastInsertRowid;
      insertLine.run(entryId, accCaja.id, p.amount, 0, `Cobro de fiado factura`);
      insertLine.run(entryId, accCxC.id, 0, p.amount, `Reducción CxC por abono`);
      count++;
    }

    for (const p of dfPayments) {
      const date = p.created_at ? p.created_at.slice(0, 10) : from;
      const entryInfo = insertEntry.run(num++, date, `Abono fiado del día — ${p.customer_name}`, 'fiado_dia_pago', p.id, p.user_id);
      const entryId = entryInfo.lastInsertRowid;
      insertLine.run(entryId, accCaja.id, p.amount, 0, `Cobro fiado día: ${p.customer_name}`);
      insertLine.run(entryId, accCxC.id, 0, p.amount, `Reducción CxC: fiado del día`);
      count++;
    }
  });
  tx();

  res.json({ message: `${count} asiento(s) generado(s) desde cobros de fiados`, count });
});

/* Generar todos los asientos pendientes de un período */
router.post('/generate-all', authenticate, requireAdmin, async (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'Se requieren fechas desde y hasta' });

  let total = 0;
  // Ejecutar cada generador secuencialmente
  const genInvoices = await new Promise((resolve, reject) => {
    req.app._router.handle({ ...req, url: '/generate-from-invoices', method: 'POST', body: { from, to } }, { ...res, json: (d) => resolve(d), status: () => ({ json: (e) => reject(e) }) }, () => {});
  }).catch(() => ({ count: 0 }));

  const genCash = await new Promise((resolve, reject) => {
    req.app._router.handle({ ...req, url: '/generate-from-cash', method: 'POST', body: { from, to } }, { ...res, json: (d) => resolve(d), status: () => ({ json: (e) => reject(e) }) }, () => {});
  }).catch(() => ({ count: 0 }));

  const genCollections = await new Promise((resolve, reject) => {
    req.app._router.handle({ ...req, url: '/generate-from-collections', method: 'POST', body: { from, to } }, { ...res, json: (d) => resolve(d), status: () => ({ json: (e) => reject(e) }) }, () => {});
  }).catch(() => ({ count: 0 }));

  total = (genInvoices.count || 0) + (genCash.count || 0) + (genCollections.count || 0);
  res.json({ message: `${total} asiento(s) generado(s) en total`, count: total });
});

/* ============ ESTADO DE RESULTADOS ============ */

router.get('/income-statement', authenticate, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Se requieren fechas desde y hasta' });

  // Ingresos por ventas (facturas no anuladas)
  const sales = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE status IN ('pagada', 'pendiente')
      AND DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).get(from, to);

  // Ingresos por abonos de fiados (cobros en el período)
  const collectionsIncome = db.prepare(`
    SELECT COALESCE(SUM(fp.amount), 0) AS total
    FROM fiado_payments fp
    WHERE DATE(fp.created_at) >= ? AND DATE(fp.created_at) <= ?
  `).get(from, to);

  const invCollectionsIncome = db.prepare(`
    SELECT COALESCE(SUM(ip.amount), 0) AS total
    FROM invoice_payments ip
    WHERE DATE(ip.created_at) >= ? AND DATE(ip.created_at) <= ?
  `).get(from, to);

  const dfCollectionsIncome = db.prepare(`
    SELECT COALESCE(SUM(dfp.amount), 0) AS total
    FROM daily_fiado_payments dfp
    WHERE DATE(dfp.created_at) >= ? AND DATE(dfp.created_at) <= ?
  `).get(from, to);

  // Costo de mercadería vendida
  const cmv = db.prepare(`
    SELECT COALESCE(SUM(ii.quantity * COALESCE(
      (SELECT p.cost_price FROM products p WHERE p.id = ii.product_id), 0)
    ), 0) AS total
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status IN ('pagada', 'pendiente')
      AND DATE(i.created_at) >= ? AND DATE(i.created_at) <= ?
  `).get(from, to);

  // Egresos de caja
  const expenses = db.prepare(`
    SELECT cm.concept, COALESCE(SUM(cm.amount), 0) AS total
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    WHERE cm.type = 'egreso'
      AND DATE(cm.created_at) >= ? AND DATE(cm.created_at) <= ?
    GROUP BY cm.concept
    ORDER BY total DESC
  `).all(from, to);

  const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);

  // Comisiones pagadas
  const commissions = db.prepare(`
    SELECT COALESCE(SUM(commission_amount), 0) AS total
    FROM invoices
    WHERE status IN ('pagada', 'pendiente')
      AND commission_amount > 0
      AND DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).get(from, to);

  const ventasBrutas = sales.total;
  const ingresosFinancieros = collectionsIncome.total + invCollectionsIncome.total + dfCollectionsIncome.total;
  const utilidadBruta = ventasBrutas - cmv.total;
  const gastosOperativos = totalExpenses + (commissions.total || 0);
  const utilidadNeta = utilidadBruta - gastosOperativos;

  res.json({
    period: { from, to },
    ventas_brutas: ventasBrutas,
    costo_mercaderia: cmv.total,
    utilidad_bruta: utilidadBruta,
    ingresos_fiados: ingresosFinancieros,
    gastos_operativos: gastosOperativos,
    gastos_detalle: expenses,
    comisiones: commissions.total || 0,
    utilidad_neta: utilidadNeta
  });
});

/* ============ BALANCE GENERAL ============ */

router.get('/balance-sheet', authenticate, (req, res) => {
  const { date } = req.query;
  const toDate = date || new Date().toISOString().slice(0, 10);

  // Activos
  const caja = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END), 0) AS saldo
    FROM cash_movements
  `).get();
  const cajaInicial = db.prepare('SELECT COALESCE(SUM(initial_amount), 0) AS total FROM cash_registers').get();
  const saldoCaja = (cajaInicial.total || 0) + (caja.saldo || 0);

  // Facturas pendientes por cobrar
  const cxC = db.prepare(`
    SELECT COALESCE(SUM(total - paid_amount), 0) AS saldo
    FROM invoices WHERE status = 'pendiente'
  `).get();

  // Fiados pendientes
  const fiadosPendientes = db.prepare(`
    SELECT COALESCE(SUM(amount - paid_amount), 0) AS saldo
    FROM fiado_cards WHERE status = 'pendiente'
  `).get();

  const fiadosDiarios = db.prepare(`
    SELECT COALESCE(SUM(amount - paid_amount), 0) AS saldo
    FROM daily_fiados WHERE status IN ('pendiente', 'vencida')
  `).get();

  const totalCxC = (cxC.saldo || 0) + (fiadosPendientes.saldo || 0) + (fiadosDiarios.saldo || 0);

  // Inventario (valor de costo)
  const inventario = db.prepare(`
    SELECT COALESCE(SUM(stock * cost_price), 0) AS total
    FROM products WHERE active = 1
  `).get();

  // Pasivos: facturas por pagar a proveedores (no hay tabla formal, usamos 0 por ahora)
  const pasivos = 0;

  // Patrimonio = Activos - Pasivos
  const totalActivos = saldoCaja + totalCxC + inventario.total;
  const totalPasivos = pasivos;
  const patrimonio = totalActivos - totalPasivos;

  // Utilidad acumulada del ejercicio
  const ingresos = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM invoices WHERE status IN ('pagada', 'pendiente')
  `).get();
  const cmvTotal = db.prepare(`
    SELECT COALESCE(SUM(ii.quantity * COALESCE(
      (SELECT p.cost_price FROM products p WHERE p.id = ii.product_id), 0)
    ), 0) AS total
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status IN ('pagada', 'pendiente')
  `).get();
  const egresos = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM cash_movements WHERE type = 'egreso'
  `).get();
  const comisionesTotal = db.prepare(`
    SELECT COALESCE(SUM(commission_amount), 0) AS total
    FROM invoices WHERE status IN ('pagada', 'pendiente') AND commission_amount > 0
  `).get();

  const utilidadEjercicio = ingresos.total - cmvTotal.total - egresos.total - (comisionesTotal.total || 0);

  res.json({
    date: toDate,
    activos: {
      caja: saldoCaja,
      cuentas_por_cobrar: totalCxC,
      inventario: inventario.total,
      total: totalActivos
    },
    pasivos: {
      total: totalPasivos
    },
    patrimonio: {
      capital: 0,
      resultados_acumulados: 0,
      resultados_ejercicio: utilidadEjercicio,
      total: patrimonio
    }
  });
});

/* ============ FLUJO DE CAJA ============ */

router.get('/cash-flow', authenticate, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Se requieren fechas desde y hasta' });

  // Ingresos por método de pago
  const incomeByMethod = db.prepare(`
    SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE status IN ('pagada', 'pendiente')
      AND DATE(created_at) >= ? AND DATE(created_at) <= ?
    GROUP BY payment_method
  `).all(from, to);

  // Ingresos de caja
  const cashIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    WHERE cm.type = 'ingreso'
      AND DATE(cm.created_at) >= ? AND DATE(cm.created_at) <= ?
  `).get(from, to);

  // Egresos de caja
  const cashExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    WHERE cm.type = 'egreso'
      AND DATE(cm.created_at) >= ? AND DATE(cm.created_at) <= ?
  `).get(from, to);

  // Egresos por concepto
  const expensesByConcept = db.prepare(`
    SELECT cm.concept, COALESCE(SUM(cm.amount), 0) AS total
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    WHERE cm.type = 'egreso'
      AND DATE(cm.created_at) >= ? AND DATE(cm.created_at) <= ?
    GROUP BY cm.concept
    ORDER BY total DESC
  `).all(from, to);

  // Abonos de fiados cobrados
  const fiadoCollections = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM fiado_payments
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).get(from, to);

  const invFiadoCollections = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM invoice_payments
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).get(from, to);

  const dfCollections = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM daily_fiado_payments
    WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).get(from, to);

  // Flujo neto = ingresos de caja - egresos de caja
  const flujoNeto = (cashIncome.total || 0) - (cashExpenses.total || 0);

  res.json({
    period: { from, to },
    ingresos_ventas: incomeByMethod,
    ingresos_caja: cashIncome.total || 0,
    ingresos_fiados: (fiadoCollections.total || 0) + (invFiadoCollections.total || 0) + (dfCollections.total || 0),
    egresos_caja: cashExpenses.total || 0,
    egresos_detalle: expensesByConcept,
    flujo_neto: flujoNeto
  });
});

/* ============ RESUMEN CONTABLE RÁPIDO ============ */

router.get('/summary', authenticate, (req, res) => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  // Ventas del mes
  const ventasMes = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
    FROM invoices WHERE status IN ('pagada', 'pendiente')
      AND DATE(created_at) >= ? AND DATE(created_at) <= ?
  `).get(firstDay, lastDay);

  // Ventas de fiado pendientes
  const fiadosPendientes = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total - paid_amount), 0) AS total
    FROM invoices WHERE status = 'pendiente'
  `).get();

  // Egresos del mes
  const egresosMes = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    WHERE cm.type = 'egreso'
      AND DATE(cm.created_at) >= ? AND DATE(cm.created_at) <= ?
  `).get(firstDay, lastDay);

  // Caja disponible
  const cajaInit = db.prepare('SELECT COALESCE(SUM(initial_amount), 0) AS total FROM cash_registers').get();
  const cajaMov = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END), 0) AS saldo
    FROM cash_movements
  `).get();
  const cajaDisponible = (cajaInit.total || 0) + (cajaMov.saldo || 0);

  // Inventario valor total
  const inventario = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(stock * cost_price), 0) AS cost,
      COALESCE(SUM(stock * sale_price), 0) AS sale
    FROM products WHERE active = 1
  `).get();

  // Asientos contables registrados
  const asientos = db.prepare('SELECT COUNT(*) AS count FROM journal_entries').get();

  // Período contable
  const primerAsiento = db.prepare('SELECT MIN(date) AS first_date FROM journal_entries').get();
  const ultimoAsiento = db.prepare('SELECT MAX(date) AS last_date FROM journal_entries').get();

  res.json({
    periodo: { desde: primerAsiento.first_date || firstDay, hasta: ultimoAsiento.last_date || lastDay },
    ventas_mes: ventasMes,
    fiados_pendientes: fiadosPendientes,
    egresos_mes: egresosMes.total || 0,
    caja_disponible: cajaDisponible,
    inventario: inventario,
    asientos_contables: asientos.count || 0
  });
});

/* ============ REPORTE DE DEUDAS ============ */

router.get('/debt-report', authenticate, (req, res) => {
  const { from } = req.query;
  const fromDate = from || '2024-01-01';
  const toDate = new Date().toISOString().slice(0, 10);

  // Facturas fiadas pendientes agrupadas por cliente
  const invoiceDebts = db.prepare(`
    SELECT 
      c.id AS customer_id,
      c.name AS client_name,
      c.phone AS client_phone,
      'Factura' AS debt_type,
      COUNT(i.id) AS document_count,
      COALESCE(SUM(i.total - i.paid_amount), 0) AS total_owed,
      COALESCE(SUM(i.paid_amount), 0) AS total_paid,
      MIN(DATE(i.created_at)) AS oldest_date,
      GROUP_CONCAT('FV-' || printf('%06d', i.number), ', ') AS documents
    FROM customers c
    JOIN invoices i ON i.customer_id = c.id
    WHERE i.status = 'pendiente'
      AND DATE(i.created_at) >= ?
    GROUP BY c.id
  `).all(fromDate);

  // Tarjetas manuales (fiados directos) pendientes
  const manualDebts = db.prepare(`
    SELECT 
      NULL AS customer_id,
      customer_name AS client_name,
      phone AS client_phone,
      'Tarjeta manual' AS debt_type,
      1 AS document_count,
      amount - paid_amount AS total_owed,
      paid_amount AS total_paid,
      fiado_date AS oldest_date,
      'Tarjeta #' || id AS documents
    FROM fiado_cards
    WHERE status = 'pendiente'
      AND fiado_date >= ?
  `).all(fromDate);

  // Fiados del día pendientes
  const dailyDebts = db.prepare(`
    SELECT 
      NULL AS customer_id,
      customer_name AS client_name,
      phone AS client_phone,
      'Fiado del día' AS debt_type,
      1 AS document_count,
      amount - paid_amount AS total_owed,
      paid_amount AS total_paid,
      fiado_date AS oldest_date,
      description AS documents
    FROM daily_fiados
    WHERE status IN ('pendiente', 'vencida')
      AND fiado_date >= ?
  `).all(fromDate);

  // Agrupar todo por nombre de cliente
  const allDebts = [...invoiceDebts, ...manualDebts, ...dailyDebts];
  const clientMap = {};

  for (const d of allDebts) {
    const key = (d.client_name || '').trim().toLowerCase();
    if (!key) continue;
    if (!clientMap[key]) {
      clientMap[key] = {
        client_name: d.client_name,
        client_phone: d.client_phone || '',
        debts: [],
        total_owed: 0,
        total_paid: 0,
        oldest_date: d.oldest_date
      };
    }
    clientMap[key].debts.push({
      type: d.debt_type,
      count: d.document_count,
      owed: d.total_owed,
      paid: d.total_paid,
      documents: d.documents
    });
    clientMap[key].total_owed += d.total_owed;
    clientMap[key].total_paid += d.total_paid;
    if (d.oldest_date && (!clientMap[key].oldest_date || d.oldest_date < clientMap[key].oldest_date)) {
      clientMap[key].oldest_date = d.oldest_date;
    }
  }

  const clients = Object.values(clientMap).sort((a, b) => b.total_owed - a.total_owed);
  const grandTotal = clients.reduce((s, c) => s + c.total_owed, 0);
  const grandPaid = clients.reduce((s, c) => s + c.total_paid, 0);

  res.json({
    from: fromDate,
    to: toDate,
    clients,
    summary: {
      total_clients: clients.length,
      total_owed: grandTotal,
      total_paid: grandPaid,
      total_balance: grandTotal
    }
  });
});

/* ============ COMPROMISOS DE PAGO ============ */

/* Listar compromisos */
router.get('/commitments', authenticate, (req, res) => {
  const commitments = db.prepare(`
    SELECT pc.*, u.full_name AS created_by_name
    FROM payment_commitments pc
    LEFT JOIN users u ON u.id = pc.created_by
    ORDER BY pc.number DESC
    LIMIT 200
  `).all();
  res.json(commitments);
});

/* Crear compromiso de pago */
router.post('/commitments', authenticate, (req, res) => {
  const { client_name, client_document, client_phone, client_address,
    debt_amount, debt_description, due_date, terms, notes } = req.body || {};

  if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  if (!debt_amount || Number(debt_amount) <= 0) return res.status(400).json({ error: 'El monto de la deuda debe ser mayor a cero' });

  const last = db.prepare('SELECT MAX(number) AS n FROM payment_commitments').get();
  const number = (last.n || 0) + 1;

  const info = db.prepare(`
    INSERT INTO payment_commitments (number, client_name, client_document, client_phone, client_address,
      debt_amount, debt_description, due_date, terms, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    number,
    client_name.trim(),
    (client_document || '').trim(),
    (client_phone || '').trim(),
    (client_address || '').trim(),
    Math.round(Number(debt_amount)),
    (debt_description || '').trim(),
    (due_date || '').trim(),
    (terms || '').trim(),
    (notes || '').trim(),
    req.user.id
  );

  res.status(201).json({ id: info.lastInsertRowid, number, message: `Compromiso #${number} generado` });
});

/* Ver un compromiso */
router.get('/commitments/:id', authenticate, (req, res) => {
  const c = db.prepare(`
    SELECT pc.*, u.full_name AS created_by_name
    FROM payment_commitments pc
    LEFT JOIN users u ON u.id = pc.created_by
    WHERE pc.id = ?
  `).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Compromiso no encontrado' });
  res.json(c);
});

/* ============ PAGARÉS FORMALES ============ */

/* Listar pagarés */
router.get('/pagares', authenticate, (req, res) => {
  const pagares = db.prepare(`
    SELECT p.*, u.full_name AS created_by_name
    FROM pagares_doc p
    LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.number DESC
    LIMIT 200
  `).all();
  res.json(pagares);
});

/* Crear pagaré */
router.post('/pagares', authenticate, (req, res) => {
  const { client_name, client_document, client_phone, client_address,
    creditor_name, creditor_document, amount, amount_words, interest_rate,
    issue_date, due_date, origin_type, origin_number, terms } = req.body || {};

  if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'El nombre del deudor es obligatorio' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
  if (!issue_date) return res.status(400).json({ error: 'La fecha de emisión es obligatoria' });

  const last = db.prepare('SELECT MAX(number) AS n FROM pagares_doc').get();
  const number = (last.n || 0) + 1;

  const info = db.prepare(`
    INSERT INTO pagares_doc (number, client_name, client_document, client_phone, client_address,
      creditor_name, creditor_document, amount, amount_words, interest_rate,
      issue_date, due_date, origin_type, origin_number, terms, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    number,
    client_name.trim(),
    (client_document || '').trim(),
    (client_phone || '').trim(),
    (client_address || '').trim(),
    (creditor_name || 'Variedades Angie').trim(),
    (creditor_document || '').trim(),
    Math.round(Number(amount)),
    (amount_words || '').trim(),
    Number(interest_rate) || 0,
    issue_date,
    (due_date || '').trim(),
    (origin_type || '').trim(),
    (origin_number || '').trim(),
    (terms || '').trim(),
    req.user.id
  );

  res.status(201).json({ id: info.lastInsertRowid, number, message: `Pagaré #${String(number).padStart(3, '0')} generado` });
});

/* Ver un pagaré */
router.get('/pagares/:id', authenticate, (req, res) => {
  const p = db.prepare(`
    SELECT pg.*, u.full_name AS created_by_name
    FROM pagares_doc pg
    LEFT JOIN users u ON u.id = pg.created_by
    WHERE pg.id = ?
  `).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pagaré no encontrado' });
  res.json(p);
});

/* Cambiar estado de un pagaré */
router.put('/pagares/:id/status', authenticate, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['pagado', 'cancelado', 'vigente'].includes(status))
    return res.status(400).json({ error: 'Estado no válido' });

  const info = db.prepare('UPDATE pagares_doc SET status = ? WHERE id = ?').run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Pagaré no encontrado' });
  res.json({ message: `Pagaré marcado como ${status}` });
});

/* Eliminar un pagaré */
router.delete('/pagares/:id', authenticate, requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM pagares_doc WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Pagaré no encontrado' });
  res.json({ message: 'Pagaré eliminado' });
});

module.exports = router;
