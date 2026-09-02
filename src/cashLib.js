/* Helper compartido para registrar cobros de abonos/fiados en la caja.
   Requiere que haya una caja abierta; si no, lanza error para que el
   cajero la abra antes de cobrar. */

/* Busca la caja actualmente abierta. Retorna null si no hay ninguna. */
function getOpenCashRegister(db) {
  return db.prepare("SELECT * FROM cash_registers WHERE status = 'abierta' ORDER BY id DESC LIMIT 1").get() || null;
}

/* Recalcula los totales de una caja a partir de sus movimientos. */
function recalcCashTotals(db, crId) {
  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN type='egreso' THEN amount ELSE 0 END), 0) AS total_expenses
    FROM cash_movements WHERE cash_register_id = ?
  `).get(crId);
  const cr = db.prepare('SELECT initial_amount FROM cash_registers WHERE id = ?').get(crId);
  const expected = cr.initial_amount + sums.total_income - sums.total_expenses;
  db.prepare('UPDATE cash_registers SET total_income = ?, total_expenses = ?, expected_total = ? WHERE id = ?')
    .run(sums.total_income, sums.total_expenses, expected, crId);
  return { ...sums, expected_total: expected };
}

/* Registra un ingreso de caja. Exige caja abierta.
   ref_source/ref_id permiten vincular el movimiento con el abono que lo
   originó (para evitar doble contabilización al generar asientos).
   Lanza Error con .status si no hay caja abierta (debe manejarse con try/catch
   en cada ruta, junto con el resto de la transacción). */
function registerCashIngreso(db, amount, concept, userId, ref_source = null, ref_id = null) {
  const cr = getOpenCashRegister(db);
  if (!cr) {
    throw Object.assign(
      new Error('No hay una caja abierta. Abrí la caja antes de registrar el abono.'),
      { status: 400 }
    );
  }
  db.prepare('INSERT INTO cash_movements (cash_register_id, type, concept, amount, user_id, ref_source, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(cr.id, 'ingreso', concept, amount, userId, ref_source, ref_id);
  recalcCashTotals(db, cr.id);
  return cr;
}

module.exports = { getOpenCashRegister, recalcCashTotals, registerCashIngreso };
