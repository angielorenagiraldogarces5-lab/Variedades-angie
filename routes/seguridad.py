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


@bp.route("/auditoria")
def auditoria():
    if not _es_admin():
        return redirect(url_for("login.login"))
    eventos = security_store.load_auditoria()
    eventos.reverse()
    return render_template("auditoria.html", eventos=eventos)
