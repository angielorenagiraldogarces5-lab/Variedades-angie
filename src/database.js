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
  payment_type TEXT NOT NULL CHECK (payment_type IN ('semanal','quincenal','mensual','colaborador')),
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

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_fiado_cards_status ON fiado_cards(status);
CREATE INDEX IF NOT EXISTS idx_fiado_payments_card ON fiado_payments(card_id);
CREATE INDEX IF NOT EXISTS idx_fiado_card_items_card ON fiado_card_items(card_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
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
