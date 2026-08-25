from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import proveedores_store

bp = Blueprint("proveedores", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/proveedores")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    proveedores = proveedores_store.load_proveedores()
    return render_template("proveedores.html", proveedores=proveedores)


@bp.route("/proveedores/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    documento = request.form.get("documento", "").strip()
    telefono = request.form.get("telefono", "").strip()
    correo = request.form.get("correo", "").strip()
    direccion = request.form.get("direccion", "").strip()

    if not nombre:
        flash("El nombre del proveedor es obligatorio.", "danger")
    else:
        ok, msg = proveedores_store.crear_proveedor(nombre, documento, telefono, correo, direccion)
        flash("Proveedor creado correctamente." if ok else msg, "success" if ok else "danger")

    return redirect(url_for("proveedores.listar"))


@bp.route("/proveedores/editar/<pid>", methods=["POST"])
def editar(pid):
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    documento = request.form.get("documento", "").strip()
    telefono = request.form.get("telefono", "").strip()
    correo = request.form.get("correo", "").strip()
    direccion = request.form.get("direccion", "").strip()

    if not nombre:
        flash("El nombre del proveedor es obligatorio.", "danger")
    else:
        ok, msg = proveedores_store.actualizar_proveedor(pid, nombre, documento, telefono, correo, direccion)
        flash(msg, "success" if ok else "danger")

    return redirect(url_for("proveedores.listar"))


@bp.route("/proveedores/eliminar/<pid>", methods=["POST"])
def eliminar(pid):
    if not _logueado():
        return redirect(url_for("login.login"))

    ok, msg = proveedores_store.eliminar_proveedor(pid)
    flash(msg, "success" if ok else "danger")

    return redirect(url_for("proveedores.listar"))
