from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import clientes_store

bp = Blueprint("clientes", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/clientes")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
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

    if not nombre:
        flash("El nombre del cliente es obligatorio.", "danger")
    else:
        ok, msg = clientes_store.crear_cliente(nombre, documento, telefono, direccion)
        flash(msg if ok else "Cliente creado correctamente.", "success" if ok else "danger")

    return redirect(url_for("clientes.listar"))


@bp.route("/clientes/editar/<cid>", methods=["POST"])
def editar(cid):
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    documento = request.form.get("documento", "").strip()
    telefono = request.form.get("telefono", "").strip()
    direccion = request.form.get("direccion", "").strip()

    if not nombre:
        flash("El nombre del cliente es obligatorio.", "danger")
    else:
        ok, msg = clientes_store.actualizar_cliente(cid, nombre, documento, telefono, direccion)
        flash(msg, "success" if ok else "danger")

    return redirect(url_for("clientes.listar"))


@bp.route("/clientes/eliminar/<cid>", methods=["POST"])
def eliminar(cid):
    if not _logueado():
        return redirect(url_for("login.login"))

    ok, msg = clientes_store.eliminar_cliente(cid)
    flash(msg, "success" if ok else "danger")

    return redirect(url_for("clientes.listar"))
