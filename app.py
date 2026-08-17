import os
from datetime import datetime, timedelta
from secrets import token_hex

from flask import Flask, flash, redirect, request, session, url_for
from flask_wtf.csrf import CSRFProtect

from utils import ahora, formatear_moneda, formatear_telefono, numero_whatsapp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _cargar_secret_key():
    clave = os.environ.get("SECRET_KEY")
    if clave:
        return clave
    ruta = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(ruta):
        with open(ruta, "r", encoding="utf-8") as f:
            clave = f.read().strip()
        if clave:
            return clave
    clave = token_hex(32)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(clave)
    return clave


app = Flask(__name__)
app.secret_key = _cargar_secret_key()

# Configuración de sesiones y cookies
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
if os.environ.get("SESSION_COOKIE_SECURE") == "1":
    app.config["SESSION_COOKIE_SECURE"] = True
# Tiempo de inactividad antes de cerrar la sesión
app.config["SESSION_IDLE_TIMEOUT"] = timedelta(minutes=30)

app.jinja_env.filters["money"] = formatear_moneda
app.jinja_env.filters["wa"] = numero_whatsapp
app.jinja_env.filters["tf"] = formatear_telefono

csrf = CSRFProtect(app)

from routes import (
    api,
    caja,
    categorias,
    clientes,
    cobranzas,
    comisiones,
    compras,
    dashboard,
    facturas,
    faltantes,
    fiados,
    importar_cobros,
    inventario,
    login,
    logout,
    notas_credito,
    pagares,
    productos,
    proveedores,
    recordatorios,
    reposicion,
    ruta_cobro,
    seguridad,
    tarjetas,
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
app.register_blueprint(tarjetas.bp)
app.register_blueprint(cobranzas.bp)
app.register_blueprint(seguridad.bp)
app.register_blueprint(recordatorios.bp)
app.register_blueprint(ruta_cobro.bp)
app.register_blueprint(importar_cobros.bp)

# La API se autentica con tokens Bearer, no con cookies: queda exenta de CSRF.
csrf.exempt(api.bp)


@app.before_request
def _control_actividad():
    if request.path.startswith(("/api/", "/static/", "/login")):
        return None
    if not session.get("logged_in"):
        return None
    ultima = session.get("ultima_actividad")
    if not ultima:
        session["ultima_actividad"] = ahora().isoformat()
        return None
    try:
        ts = datetime.fromisoformat(ultima)
    except (TypeError, ValueError):
        session["ultima_actividad"] = ahora().isoformat()
        return None
    if ahora() - ts > app.config["SESSION_IDLE_TIMEOUT"]:
        session.clear()
        flash("Tu sesión expiró por inactividad. Ingresá nuevamente.", "warning")
        return redirect(url_for("login.login"))
    session["ultima_actividad"] = ahora().isoformat()
    return None


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
