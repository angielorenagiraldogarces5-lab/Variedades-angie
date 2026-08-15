from flask import Blueprint, redirect, request, session, url_for

from routes import security_store

bp = Blueprint("logout", __name__)


@bp.route("/logout")
def logout():
    username = session.get("username")
    ip = request.remote_addr or ""
    if username:
        security_store.registrar_evento("logout", username, "Cierre de sesión", ip)
    session.clear()
    return redirect(url_for("login.login"))
