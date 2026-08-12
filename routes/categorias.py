from flask import Blueprint, redirect, render_template, session, url_for

from routes import productos_store

bp = Blueprint("categorias", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/categorias")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    grupos = productos_store.agrupar_por_categoria()
    return render_template("categorias.html", grupos=grupos)
