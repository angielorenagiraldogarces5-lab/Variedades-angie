from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import security_store, usuarios_store
from utils import ahora

bp = Blueprint("login", __name__)


@bp.route("/", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        ip = request.remote_addr or ""

        bloqueado, minutos = security_store.esta_bloqueado(username)
        if bloqueado:
            error = (
                "Demasiados intentos fallidos. La cuenta está bloqueada temporalmente. "
                f"Intentá de nuevo en {minutos} min."
            )
        else:
            usuario = usuarios_store.verificar_usuario(username, password)
            if usuario:
                security_store.limpiar_intentos(username)
                session.clear()
                session.permanent = True
                session["logged_in"] = True
                session["username"] = username
                session["nombre"] = usuario["nombre"]
                session["rol"] = usuario["rol"]
                session["ultima_actividad"] = ahora().isoformat()
                security_store.registrar_evento("login", username, "Acceso correcto", ip)
                if usuarios_store.es_contrasena_inicial(username):
                    session["debe_cambiar_password"] = True
                    flash(
                        "Por seguridad, debés cambiar tu contraseña inicial antes de continuar.",
                        "warning",
                    )
                    return redirect(url_for("seguridad.cambiar_contrasena"))
                return redirect(url_for("dashboard.dashboard"))
            else:
                bloqueado, minutos = security_store.registrar_intento_fallido(username, ip)
                security_store.registrar_evento(
                    "login_fallido", username, "Usuario o contraseña incorrectos", ip
                )
                if bloqueado:
                    security_store.registrar_evento(
                        "bloqueo",
                        username,
                        f"Cuenta bloqueada por {security_store.BLOQUEO_MINUTOS} min por intentos fallidos",
                        ip,
                    )
                    error = (
                        "Demasiados intentos fallidos. La cuenta quedó bloqueada temporalmente. "
                        f"Intentá de nuevo en {minutos} min."
                    )
                else:
                    error = "Usuario o contraseña incorrectos."

    return render_template("login.html", error=error)
