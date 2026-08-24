const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const db = require('../database');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuario inactivo o no válido' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada, inicia sesión de nuevo' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede realizar esta acción' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
