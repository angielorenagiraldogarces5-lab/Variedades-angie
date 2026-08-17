from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import clientes_store, fiados_store, scoring

bp = Blueprint("clientes", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/clientes")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    clientes = clientes_store.load_clientes()
    fiados_mod = fiados_store.load_fiados()
    for cid, c in clientes.items():
        scoring.actualizar_estado_moroso(cid, fiados_mod)
        scoring.actualizar_credito_cliente(cid, fiados_mod)
    clientes = clientes_store.load_clientes()
    return render_template("clientes.html", clientes=clientes)


@bp.route("/clientes/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    documento = request.form.get("documento", "").strip()
    telefono = request.form.get("telefono", "").strip()
    direccion = request.form.get("direccion", "").strip()
    limite = request.form.get("limite_credito", "0").strip()

    try:
        limite = float(limite) if limite else 0
    except ValueError:
        limite = 0

    if not nombre:
        flash("El nombre del cliente es obligatorio.", "danger")
    else:
        ok, msg = clientes_store.crear_cliente(nombre, documento, telefono, direccion, limite)
        flash("Cliente creado correctamente.", "success")

    return redirect(url_for("clientes.listar"))


@bp.route("/clientes/editar/<cid>", methods=["POST"])
def editar(cid):
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    documento = request.form.get("documento", "").strip()
    telefono = request.form.get("telefono", "").strip()
    direccion = request.form.get("direccion", "").strip()
    limite = request.form.get("limite_credito", "").strip()

    try:
        limite = float(limite) if limite else None
    except ValueError:
        limite = None

    if not nombre:
        flash("El nombre del cliente es obligatorio.", "danger")
    else:
        ok, msg = clientes_store.actualizar_cliente(cid, nombre, documento, telefono, direccion, limite)
        flash(msg, "success" if ok else "danger")

    return redirect(url_for("clientes.listar"))


@bp.route("/clientes/eliminar/<cid>", methods=["POST"])
def eliminar(cid):
    if not _logueado():
        return redirect(url_for("login.login"))

    ok, msg = clientes_store.eliminar_cliente(cid)
    flash(msg, "success" if ok else "danger")

    return redirect(url_for("clientes.listar"))
