const router = require('express').Router();
const db = require('../database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_products,
      COALESCE(SUM(stock), 0) AS total_units,
      COALESCE(SUM(stock * cost_price), 0) AS inventory_cost_value,
      COALESCE(SUM(stock * sale_price), 0) AS inventory_sale_value,
      SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END) AS low_stock_count
    FROM products WHERE active = 1
  `).get();

  const categoriesCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  const movementsToday = db.prepare("SELECT COUNT(*) AS n FROM movements WHERE date(created_at) = date('now','localtime')").get().n;

  const lowStockProducts = db.prepare(`
    SELECT id, code, name, stock, min_stock, unit
    FROM products
    WHERE active = 1 AND stock <= min_stock
    ORDER BY (stock - min_stock), name
    LIMIT 10
  `).all();

  const recentMovements = db.prepare(`
    SELECT m.*, p.name AS product_name, u.full_name AS user_name
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC LIMIT 8
  `).all();

  const topCategories = db.prepare(`
    SELECT c.name, COUNT(p.id) AS product_count, COALESCE(SUM(p.stock * p.cost_price),0) AS value
    FROM categories c JOIN products p ON p.category_id = c.id AND p.active = 1
    GROUP BY c.id ORDER BY product_count DESC LIMIT 5
  `).all();

  res.json({ totals, categoriesCount, movementsToday, lowStockProducts, recentMovements, topCategories });
});

module.exports = router;
