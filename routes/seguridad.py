import secrets
import string

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import security_store, usuarios_store

bp = Blueprint("seguridad", __name__)


def _logueado():
    return session.get("logged_in")


def _es_admin():
    return session.get("logged_in") and session.get("rol") in ("Admin", "Dueño")


@bp.route("/cambiar-contrasena", methods=["GET", "POST"])
def cambiar_contrasena():
    if not _logueado():
        return redirect(url_for("login.login"))

    if request.method == "POST":
        actual = request.form.get("actual", "")
        nueva = request.form.get("nueva", "")
        confirmar = request.form.get("confirmar", "")
        if nueva != confirmar:
            flash("La confirmación no coincide con la nueva contraseña.", "danger")
        else:
            ok, msg = usuarios_store.cambiar_password(
                session.get("username"), actual, nueva
            )
            flash(msg, "success" if ok else "danger")
            if ok:
                session.pop("debe_cambiar_password", None)
                security_store.registrar_evento(
                    "cambio_password",
                    session.get("username"),
                    "Cambió su contraseña",
                    request.remote_addr or "",
                )
        return redirect(url_for("seguridad.cambiar_contrasena"))

    return render_template(
        "cambiar_contrasena.html",
        debe_cambiar=session.get("debe_cambiar_password"),
    )


@bp.route("/recuperar-contrasena", methods=["GET", "POST"])
def recuperar_contrasena():
    temp_password = None
    username_recuperado = None
    error_recuperacion = None

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        if not username:
            error_recuperacion = "Ingresá un nombre de usuario."
        else:
            usuarios = usuarios_store.load_usuarios()
            if username not in usuarios:
                error_recuperacion = f"El usuario '{username}' no existe."
            else:
                alphabet = string.ascii_letters + string.digits
                temp_password = "".join(secrets.choice(alphabet) for _ in range(10))
                temp_password = "Temp" + temp_password
                ok, msg = usuarios_store.actualizar_usuario(username, password=temp_password)
                if ok:
                    security_store.limpiar_intentos(username)
                    username_recuperado = username
                    security_store.registrar_evento(
                        "recuperacion_password",
                        username,
                        "Contraseña reseteada desde recuperación",
                        request.remote_addr or "",
                    )
                else:
                    error_recuperacion = msg

    return render_template(
        "recuperar_contrasena.html",
        temp_password=temp_password,
        username_recuperado=username_recuperado,
        error_recuperacion=error_recuperacion,
    )


@bp.route("/bloqueos")
def bloqueos():
    if not _es_admin():
        return redirect(url_for("login.login"))
    bloqueados = security_store.listar_bloqueados()
    return render_template("bloqueos.html", bloqueados=bloqueados)


@bp.route("/desbloquear/<username>", methods=["POST"])
def desbloquear(username):
    if not _es_admin():
        return redirect(url_for("login.login"))
    ok = security_store.desbloquear_usuario(username)
    if ok:
        security_store.registrar_evento(
            "desbloqueo",
            session.get("username"),
            f"Desbloqueó la cuenta de '{username}'",
            request.remote_addr or "",
        )
        flash(f"La cuenta '{username}' fue desbloqueada correctamente.", "success")
    else:
        flash(f"La cuenta '{username}' no está bloqueada.", "warning")
    return redirect(url_for("seguridad.bloqueos"))


@bp.route("/auditoria")
def auditoria():
    if not _es_admin():
        return redirect(url_for("login.login"))
    eventos = security_store.load_auditoria()
    eventos.reverse()
    return render_template("auditoria.html", eventos=eventos)
