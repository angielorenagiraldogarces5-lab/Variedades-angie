const db = require('../database');

db.exec(`
CREATE TABLE IF NOT EXISTS credit_blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  is_blocked INTEGER NOT NULL DEFAULT 1,
  reason TEXT DEFAULT '',
  blocked_by INTEGER REFERENCES users(id),
  blocked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  auto_blocked INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_credit_blacklist_blocked ON credit_blacklist(is_blocked);
CREATE INDEX IF NOT EXISTS idx_credit_blacklist_name ON credit_blacklist(customer_name);
`);

const settingExists = db.prepare("SELECT 1 FROM settings WHERE key = 'credit_block_days'").get();
if (!settingExists) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('credit_block_days', '90')").run();
}

module.exports = db;
