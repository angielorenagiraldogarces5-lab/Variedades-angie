from flask import Flask

from utils import formatear_moneda, formatear_telefono, numero_whatsapp

app = Flask(__name__)
app.secret_key = "sistema_angie_roles_secret"
app.jinja_env.filters["money"] = formatear_moneda
app.jinja_env.filters["wa"] = numero_whatsapp
app.jinja_env.filters["tf"] = formatear_telefono

from routes import (
    api,
    caja,
    categorias,
    clientes,
    comisiones,
    compras,
    dashboard,
    facturas,
    faltantes,
    fiados,
    inventario,
    login,
    logout,
    notas_credito,
    pagares,
    productos,
    proveedores,
    reposicion,
    tienda,
    users,
)

app.register_blueprint(login.bp)
app.register_blueprint(dashboard.bp)
app.register_blueprint(logout.bp)
app.register_blueprint(caja.bp)
app.register_blueprint(users.bp)
app.register_blueprint(comisiones.bp)
app.register_blueprint(clientes.bp)
app.register_blueprint(productos.bp)
app.register_blueprint(categorias.bp)
app.register_blueprint(proveedores.bp)
app.register_blueprint(reposicion.bp)
app.register_blueprint(faltantes.bp)
app.register_blueprint(inventario.bp)
app.register_blueprint(facturas.bp)
app.register_blueprint(fiados.bp)
app.register_blueprint(notas_credito.bp)
app.register_blueprint(pagares.bp)
app.register_blueprint(compras.bp)
app.register_blueprint(api.bp)
app.register_blueprint(tienda.bp)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
