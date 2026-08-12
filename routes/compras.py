from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import (
    compras_store,
    inventario_store,
    productos_store,
    proveedores_store,
)
from utils import ahora

bp = Blueprint("compras", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/compras")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    compras = compras_store.load_compras()
    return render_template(
        "compras.html",
        compras=compras,
        rol=session.get("rol"),
    )


@bp.route("/compras/nueva")
def nueva():
    if not _logueado():
        return redirect(url_for("login.login"))
    return render_template(
        "nueva_compra.html",
        proveedores=proveedores_store.load_proveedores(),
        productos=productos_store.load_productos(),
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/compras/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    estado = request.form.get("estado", "Pendiente")
    if estado not in compras_store.ESTADOS:
        estado = "Pendiente"
    observacion = request.form.get("observacion", "").strip()

    # Proveedor: existente o nuevo
    proveedor_id = request.form.get("proveedor_id", "")
    if proveedor_id == "nuevo":
        nombre = request.form.get("proveedor_nombre", "").strip()
        if not nombre:
            flash("Debe seleccionar o registrar un proveedor.", "danger")
            return redirect(url_for("compras.nueva"))
        documento = request.form.get("proveedor_documento", "").strip()
        telefono = request.form.get("proveedor_telefono", "").strip()
        correo = request.form.get("proveedor_correo", "").strip()
        direccion = request.form.get("proveedor_direccion", "").strip()
        ok, msg = proveedores_store.crear_proveedor(
            nombre, documento, telefono, correo, direccion
        )
        if not ok:
            flash(msg, "danger")
            return redirect(url_for("compras.nueva"))
        proveedor = {
            "id": msg,
            "nombre": nombre,
            "documento": documento,
            "telefono": telefono,
            "correo": correo,
            "direccion": direccion,
        }
    elif proveedor_id:
        p = proveedores_store.load_proveedores().get(proveedor_id)
        if not p:
            flash("El proveedor seleccionado no existe.", "danger")
            return redirect(url_for("compras.nueva"))
        proveedor = {"id": proveedor_id, **p}
    else:
        flash("Debe seleccionar o registrar un proveedor.", "danger")
        return redirect(url_for("compras.nueva"))

    # Items
    descripciones = request.form.getlist("descripcion[]")
    cantidades = request.form.getlist("cantidad[]")
    costos = request.form.getlist("costo[]")

    items = []
    for i, desc in enumerate(descripciones):
        desc = desc.strip()
        if not desc:
            continue
        try:
            cantidad = float(cantidades[i] or 0)
            costo = float(costos[i] or 0)
        except (ValueError, IndexError):
            continue
        if cantidad <= 0 or costo < 0:
            continue
        items.append(
            {
                "descripcion": desc,
                "cantidad": round(cantidad, 2),
                "costo": round(costo, 2),
                "subtotal": round(cantidad * costo, 2),
            }
        )

    if not items:
        flash("Debe agregar al menos un producto con cantidad válida.", "danger")
        return redirect(url_for("compras.nueva"))

    ok, msg = compras_store.crear_compra(
        fecha, proveedor, items, estado, observacion, session.get("nombre")
    )
    if not ok:
        flash(msg, "danger")
        return redirect(url_for("compras.nueva"))
    numero = msg

    # Vincular productos del catálogo y sumar stock
    productos = productos_store.load_productos()
    compras = compras_store.load_compras()
    for item in compras[numero]["items"]:
        pid = productos_store.buscar_pid_por_nombre(item["descripcion"])
        if pid is None:
            continue
        if not productos.get(pid, {}).get("control_stock", False):
            continue
        item["pid"] = pid
        ok, mid = inventario_store.registrar_entrada(
            pid,
            item["cantidad"],
            f"Compra {numero}",
            fecha,
            session.get("nombre"),
            referencia=numero,
        )
        if ok:
            item["mov_id"] = mid
    compras_store.save_compras(compras)

    # Pago en caja si se registró como pagada
    if estado == "Pagada":
        ok, msg_pago = compras_store.registrar_pago_compra(numero, session.get("nombre"))
        if not ok:
            compras_store.revertir_a_pendiente(numero)
            flash(
                f"La compra {numero} quedó como 'Pendiente': no se pudo descontar "
                f"de la caja: {msg_pago}",
                "danger",
            )

    flash(f"Compra {numero} registrada correctamente.", "success")
    return redirect(url_for("compras.ver", numero=numero))


@bp.route("/compras/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    compra = compras_store.load_compras().get(numero)
    if not compra:
        flash("La compra no existe.", "danger")
        return redirect(url_for("compras.listar"))
    return render_template(
        "compra.html",
        compra=compra,
        rol=session.get("rol"),
    )


@bp.route("/compras/<numero>/estado", methods=["POST"])
def cambiar_estado(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    estado = request.form.get("estado", "Pendiente")
    ok, msg = compras_store.actualizar_estado(numero, estado, session.get("nombre"))
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("compras.ver", numero=numero))


@bp.route("/compras/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = compras_store.eliminar_compra(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("compras.listar"))
