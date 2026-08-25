const express = require('express');
const path = require('path');
const db = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
/* no-cache: el navegador guarda los archivos pero pregunta si hubo cambios
   antes de usarlos; así siempre carga la última versión de la aplicación */
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache')
}));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/categories', require('./src/routes/categories'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/movements', require('./src/routes/movements'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/collections', require('./src/routes/collections'));
app.use('/api/invoices', require('./src/routes/invoices'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/suppliers', require('./src/routes/suppliers'));
app.use('/api/cashregister', require('./src/routes/cashregister'));
app.use('/api/daily-fiados', require('./src/routes/fiados_cortos'));
app.use('/api/accounting', require('./src/routes/accounting'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Cualquier otra ruta devuelve la aplicación
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Manejo global de errores
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log('');
  console.log('  ========================================');
  console.log('   SISTEMA DE INVENTARIO - VARIEDADES ANGIE');
  console.log('  ========================================');
  console.log(`   Abre en tu navegador: http://localhost:${PORT}`);
  console.log('   Usuario inicial: admin | Contraseña: angie123');
  console.log('');
});
