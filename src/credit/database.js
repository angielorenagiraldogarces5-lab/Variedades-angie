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

CREATE TABLE IF NOT EXISTS credit_risk_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'observation',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_credit_risk_notes_name ON credit_risk_notes(customer_name);

CREATE TABLE IF NOT EXISTS credit_unblock_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blacklist_id INTEGER,
  customer_name TEXT NOT NULL,
  unblocked_by INTEGER REFERENCES users(id),
  unblocked_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_unblock_log_name ON credit_unblock_log(customer_name);
CREATE INDEX IF NOT EXISTS idx_unblock_log_date ON credit_unblock_log(unblocked_at);
`);

const settingExists = db.prepare("SELECT 1 FROM settings WHERE key = 'credit_block_days'").get();
if (!settingExists) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('credit_block_days', '90')").run();
}

module.exports = db;
