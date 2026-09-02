const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');
const { DATA_DIR } = require('./config');

const db = new DatabaseSync(path.join(DATA_DIR, 'inventario.db'));

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'vendedor' CHECK (role IN ('admin','vendedor')),
  active INTEGER NOT NULL DEFAULT 1,
  commission_rate REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'unidad',
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sale_price REAL NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 5 CHECK (min_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('entrada','salida','ajuste')),
  quantity INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo','tarjeta','transferencia','fiado')),
  status TEXT NOT NULL DEFAULT 'pagada' CHECK (status IN ('pagada','pendiente','anulada')),
  total REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_amount REAL NOT NULL DEFAULT 0,
  paid_at TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  seller_user_id INTEGER REFERENCES users(id),
  commission_rate REAL,
  commission_amount REAL
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  code TEXT DEFAULT '',
  name TEXT NOT NULL,
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total REAL NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

/* Pedidos: se anotan sin tocar stock; al entregar se facturan */
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  seller_user_id INTEGER REFERENCES users(id),
  client_name TEXT DEFAULT '',
  client_phone TEXT DEFAULT '',
  client_address TEXT DEFAULT '',
  delivery_date TEXT,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','confirmado','listo','entregado','cancelado')),
  total REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* Artículos de cada pedido */
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  code TEXT DEFAULT '',
  name TEXT NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total REAL NOT NULL DEFAULT 0 CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'efectivo' CHECK (method IN ('efectivo','transferencia','otro')),
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  payment_date TEXT
);

CREATE TABLE IF NOT EXISTS fiado_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  item_code TEXT DEFAULT '',
  item_name TEXT DEFAULT '',
  payment_type TEXT NOT NULL CHECK (payment_type IN ('diario','8dias','semanal','quincenal','mensual','colaborador')),
  fiado_date TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','pagada','anulada')),
  paid_at TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS fiado_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES fiado_cards(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'efectivo' CHECK (method IN ('efectivo','transferencia','otro')),
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  payment_date TEXT
);

/* Artículos que trae cada tarjeta de cobro (para subir tarjetas físicas
   con varios artículos; el total de la tarjeta es la suma de estos) */
CREATE TABLE IF NOT EXISTS fiado_card_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES fiado_cards(id) ON DELETE CASCADE,
  code TEXT DEFAULT '',
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price REAL NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  line_total REAL NOT NULL DEFAULT 0 CHECK (line_total >= 0)
);

/* Proveedores */
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  document TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* Caja (arqueo de cajas) */
CREATE TABLE IF NOT EXISTS cash_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  cashier_name TEXT NOT NULL,
  initial_amount REAL NOT NULL DEFAULT 0 CHECK (initial_amount >= 0),
  total_income REAL NOT NULL DEFAULT 0,
  total_expenses REAL NOT NULL DEFAULT 0,
  expected_total REAL NOT NULL DEFAULT 0,
  counted_amount REAL,
  difference REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','cerrada')),
  open_notes TEXT DEFAULT '',
  close_notes TEXT DEFAULT '',
  closed_by TEXT DEFAULT ''
);

/* Movimientos de caja */
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ingreso','egreso')),
  concept TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  user_id INTEGER REFERENCES users(id),
  ref_source TEXT DEFAULT '',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_fiado_cards_status ON fiado_cards(status);
CREATE INDEX IF NOT EXISTS idx_fiado_payments_card ON fiado_payments(card_id);
CREATE INDEX IF NOT EXISTS idx_fiado_card_items_card ON fiado_card_items(card_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

/* Fiados del día: plazos cortos (diario, 8 días, semanal, etc.) */
CREATE TABLE IF NOT EXISTS daily_fiados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL CHECK (amount > 0),
  paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('diario','8dias','semanal','quincenal','mensual')),
  fiado_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','pagada','vencida')),
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_daily_fiados_status ON daily_fiados(status);
CREATE INDEX IF NOT EXISTS idx_daily_fiados_due ON daily_fiados(due_date);

CREATE TABLE IF NOT EXISTS daily_fiado_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiado_id INTEGER NOT NULL REFERENCES daily_fiados(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'efectivo' CHECK (method IN ('efectivo','transferencia','otro')),
  notes TEXT DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  payment_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_daily_fiado_payments_fiado ON daily_fiado_payments(fiado_id);

/* ============ DOCUMENTOS DE DEUDA ============ */
/* Compromisos de pago (documento simple donde el cliente se compromete a pagar) */
CREATE TABLE IF NOT EXISTS payment_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  client_document TEXT DEFAULT '',
  client_phone TEXT DEFAULT '',
  client_address TEXT DEFAULT '',
  debt_amount REAL NOT NULL DEFAULT 0,
  debt_description TEXT DEFAULT '',
  due_date TEXT,
  terms TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* Pagarés formales (documento legal con cláusulas) */
CREATE TABLE IF NOT EXISTS pagares_doc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  client_document TEXT DEFAULT '',
  client_phone TEXT DEFAULT '',
  client_address TEXT DEFAULT '',
  creditor_name TEXT DEFAULT 'Variedades Angie',
  creditor_document TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  amount_words TEXT DEFAULT '',
  interest_rate REAL DEFAULT 0,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  origin_type TEXT DEFAULT '',
  origin_number TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','pagado','cancelado')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* ============ CONTABILIDAD ============ */
/* Plan de cuentas */
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('activo','pasivo','patrimonio','ingreso','gasto')),
  parent_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* Asientos contables (libro diario) */
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT DEFAULT '',
  source_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

/* Líneas del asiento (débito / crédito) */
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);

/* Plan de cuentas por defecto para Variedades Angie */
INSERT OR IGNORE INTO accounts (code, name, type) VALUES
  ('1101', 'Caja General', 'activo'),
  ('1102', 'Banco', 'activo'),
  ('1103', 'Cuentas por Cobrar (Fiados)', 'activo'),
  ('1104', 'Inventario de Mercaderías', 'activo'),
  ('1201', 'Mobiliario y Equipo', 'activo'),
  ('2101', 'Cuentas por Pagar', 'pasivo'),
  ('2102', 'IVA Débito Fiscal', 'pasivo'),
  ('2103', 'IVA Crédito Fiscal', 'pasivo'),
  ('3101', 'Capital Social', 'patrimonio'),
  ('3102', 'Resultados Acumulados', 'patrimonio'),
  ('3103', 'Resultados del Ejercicio', 'patrimonio'),
  ('4101', 'Ventas', 'ingreso'),
  ('4102', 'Otros Ingresos', 'ingreso'),
  ('5101', 'Costo de Mercadería Vendida', 'gasto'),
  ('5201', 'Gastos Operativos', 'gasto'),
  ('5202', 'Sueldos y Cargas Sociales', 'gasto'),
  ('5203', 'Servicios Públicos', 'gasto'),
  ('5204', 'Alquileres', 'gasto'),
  ('5205', 'Comisiones y Honorarios', 'gasto'),
  ('5206', 'Gastos Varios', 'gasto');
`);

/* Migraciones para bases creadas con versiones anteriores:
   datos del cliente escritos a mano en la factura (venta de mostrador) */
const invoiceCols = db.prepare("PRAGMA table_info(invoices)").all().map(c => c.name);
if (!invoiceCols.includes('client_name')) db.exec("ALTER TABLE invoices ADD COLUMN client_name TEXT DEFAULT ''");
if (!invoiceCols.includes('client_address')) db.exec("ALTER TABLE invoices ADD COLUMN client_address TEXT DEFAULT ''");
if (!invoiceCols.includes('client_phone')) db.exec("ALTER TABLE invoices ADD COLUMN client_phone TEXT DEFAULT ''");
if (!invoiceCols.includes('client_email')) db.exec("ALTER TABLE invoices ADD COLUMN client_email TEXT DEFAULT ''");

/* Fecha en que se cobró realmente cada abono (puede anotarse después) */
const fiadoPaymentCols = db.prepare("PRAGMA table_info(fiado_payments)").all().map(c => c.name);
if (!fiadoPaymentCols.includes('payment_date')) db.exec('ALTER TABLE fiado_payments ADD COLUMN payment_date TEXT');
const invoicePaymentCols = db.prepare("PRAGMA table_info(invoice_payments)").all().map(c => c.name);
if (!invoicePaymentCols.includes('payment_date')) db.exec('ALTER TABLE invoice_payments ADD COLUMN payment_date TEXT');

/* Vendedor y comisión por factura (% individual o el general de configuración) */
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('commission_rate')) db.exec('ALTER TABLE users ADD COLUMN commission_rate REAL');
const invCols = db.prepare("PRAGMA table_info(invoices)").all().map(c => c.name);
if (!invCols.includes('seller_user_id')) db.exec('ALTER TABLE invoices ADD COLUMN seller_user_id INTEGER REFERENCES users(id)');
if (!invCols.includes('commission_rate')) db.exec('ALTER TABLE invoices ADD COLUMN commission_rate REAL');
if (!invCols.includes('commission_amount')) db.exec('ALTER TABLE invoices ADD COLUMN commission_amount REAL');

/* Vínculo de movimientos de caja con los abonos que los originan
   (evita doble contabilización al generar asientos) */
const cmCols = db.prepare("PRAGMA table_info(cash_movements)").all().map(c => c.name);
if (!cmCols.includes('ref_source')) db.exec('ALTER TABLE cash_movements ADD COLUMN ref_source TEXT DEFAULT \'\'');
if (!cmCols.includes('ref_id')) db.exec('ALTER TABLE cash_movements ADD COLUMN ref_id INTEGER');

// Datos del negocio por defecto (editables desde Configuración).
// Si falta alguna clave (p. ej. al agregar nuevas), se agrega automáticamente.
const DEFAULT_SETTINGS = {
  store_name: 'Variedades Angie',
  nit: '',
  address: '',
  phone: '',
  commission_rate: '15',
  invoice_footer: 'Conserve esta factura para cambios o garantías. ¡Gracias por su compra!'
};
const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

// Usuario administrador por defecto: admin / angie123
const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
if (adminCount === 0) {
  db.prepare(
    "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')"
  ).run('admin', bcrypt.hashSync('angie123', 10), 'Administrador');
}

module.exports = db;
