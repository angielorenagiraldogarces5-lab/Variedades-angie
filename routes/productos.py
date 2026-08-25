from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import productos_store

bp = Blueprint("productos", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/productos")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    productos = productos_store.load_productos()
    return render_template("productos.html", productos=productos)


@bp.route("/productos/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    categoria = request.form.get("categoria", "").strip()
    codigo = request.form.get("codigo", "").strip() or None
    precio = request.form.get("precio", "").strip()
    costo = request.form.get("costo", "0").strip()
    stock = request.form.get("stock", "0").strip()
    stock_minimo = request.form.get("stock_minimo", "0").strip()
    control_stock = request.form.get("control_stock") == "on"

    if not nombre:
        flash("El nombre del producto o servicio es obligatorio.", "danger")
    else:
        try:
            precio = float(precio)
            costo = float(costo or 0)
            stock = float(stock or 0)
            stock_minimo = float(stock_minimo or 0)
            if precio < 0 or costo < 0 or stock < 0 or stock_minimo < 0:
                raise ValueError
        except ValueError:
            flash("Precio, costo, stock y stock mínimo deben ser números válidos.", "danger")
            return redirect(url_for("productos.listar"))

        ok, msg = productos_store.crear_producto(
            nombre, categoria, precio, stock, stock_minimo, control_stock, costo, codigo
        )
        flash(msg if ok else "Producto creado correctamente.", "success" if ok else "danger")

    return redirect(url_for("productos.listar"))


@bp.route("/productos/editar/<pid>", methods=["POST"])
def editar(pid):
    if not _logueado():
        return redirect(url_for("login.login"))

    nombre = request.form.get("nombre", "").strip()
    categoria = request.form.get("categoria", "").strip()
    codigo = request.form.get("codigo", "").strip() or None
    precio = request.form.get("precio", "").strip()
    costo = request.form.get("costo", "0").strip()
    stock = request.form.get("stock", "0").strip()
    stock_minimo = request.form.get("stock_minimo", "0").strip()
    control_stock = request.form.get("control_stock") == "on"

    if not nombre:
        flash("El nombre del producto o servicio es obligatorio.", "danger")
    else:
        try:
            precio = float(precio)
            costo = float(costo or 0)
            stock = float(stock or 0)
            stock_minimo = float(stock_minimo or 0)
            if precio < 0 or costo < 0 or stock < 0 or stock_minimo < 0:
                raise ValueError
        except ValueError:
            flash("Precio, costo, stock y stock mínimo deben ser números válidos.", "danger")
            return redirect(url_for("productos.listar"))

        ok, msg = productos_store.actualizar_producto(
            pid, nombre, categoria, precio, stock, stock_minimo, control_stock, costo, codigo
        )
        flash(msg, "success" if ok else "danger")

    return redirect(url_for("productos.listar"))


@bp.route("/productos/eliminar/<pid>", methods=["POST"])
def eliminar(pid):
    if not _logueado():
        return redirect(url_for("login.login"))

    ok, msg = productos_store.eliminar_producto(pid)
    flash(msg, "success" if ok else "danger")

    return redirect(url_for("productos.listar"))
