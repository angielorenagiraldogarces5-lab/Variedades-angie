from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import (
    clientes_store,
    facturas_store,
    inventario_store,
    productos_store,
    usuarios_store,
)
from utils import ahora

bp = Blueprint("facturas", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/facturas")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    facturas = facturas_store.load_facturas()
    return render_template(
        "facturas.html",
        facturas=facturas,
        rol=session.get("rol"),
    )


@bp.route("/facturas/nueva")
def nueva():
    if not _logueado():
        return redirect(url_for("login.login"))
    return render_template(
        "nueva_factura.html",
        clientes=clientes_store.load_clientes(),
        productos=productos_store.load_productos(),
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/facturas/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    tipo = request.form.get("tipo", "Factura")
    if tipo not in facturas_store.TIPOS:
        tipo = "Factura"
    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    estado = request.form.get("estado", "Pendiente")
    observacion = request.form.get("observacion", "").strip()

    forma_pago = request.form.get("forma_pago", "Efectivo")
    if forma_pago not in facturas_store.FORMAS_PAGO:
        forma_pago = "Efectivo"
    if forma_pago in ("Crédito", "Fiado") and estado == "Pagada":
        estado = "Pendiente"

    # Cliente: existente o nuevo
    cliente_id = request.form.get("cliente_id", "")
    if cliente_id == "nuevo":
        nombre = request.form.get("cliente_nombre", "").strip()
        if not nombre:
            flash("Debe seleccionar o registrar un cliente.", "danger")
            return redirect(url_for("facturas.nueva"))
        documento = request.form.get("cliente_documento", "").strip()
        telefono = request.form.get("cliente_telefono", "").strip()
        direccion = request.form.get("cliente_direccion", "").strip()
        ok, msg = clientes_store.crear_cliente(nombre, documento, telefono, direccion)
        if not ok:
            flash(msg, "danger")
            return redirect(url_for("facturas.nueva"))
        cliente = {
            "id": msg,
            "nombre": nombre,
            "documento": documento,
            "telefono": telefono,
            "direccion": direccion,
        }
    elif cliente_id:
        cliente = clientes_store.buscar_cliente(cliente_id)
        if not cliente:
            flash("El cliente seleccionado no existe.", "danger")
            return redirect(url_for("facturas.nueva"))
        cliente = {"id": cliente_id, **cliente}
    else:
        flash("Debe seleccionar o registrar un cliente.", "danger")
        return redirect(url_for("facturas.nueva"))

    # Items
    descripciones = request.form.getlist("descripcion[]")
    cantidades = request.form.getlist("cantidad[]")
    precios = request.form.getlist("precio[]")

    items = []
    for i, desc in enumerate(descripciones):
        desc = desc.strip()
        if not desc:
            continue
        try:
            cantidad = float(cantidades[i] or 0)
            precio = float(precios[i] or 0)
        except (ValueError, IndexError):
            continue
        if cantidad <= 0 or precio < 0:
            continue
        items.append(
            {
                "descripcion": desc,
                "cantidad": cantidad,
                "precio": round(precio, 2),
                "subtotal": round(cantidad * precio, 2),
            }
        )

    if not items:
        flash("Debe agregar al menos un producto o servicio con cantidad válida.", "danger")
        return redirect(url_for("facturas.nueva"))

    # Verificar stock disponible antes de emitir
    productos = productos_store.load_productos()
    for item in items:
        pid = productos_store.buscar_pid_por_nombre(item["descripcion"])
        if pid is None or not productos.get(pid, {}).get("control_stock", False):
            continue
        stock = float(productos[pid].get("stock", 0))
        if stock < item["cantidad"]:
            flash(
                f"Stock insuficiente de '{item['descripcion']}': disponible "
                f"{stock:g}, requerido {item['cantidad']:g}.",
                "danger",
            )
            return redirect(url_for("facturas.nueva"))
        item["pid"] = pid

    numero = facturas_store.crear_factura(
        tipo,
        fecha,
        cliente,
        items,
        estado,
        observacion,
        session.get("nombre"),
        forma_pago,
        vendedor_username=session.get("username", ""),
        comision_pct=usuarios_store.load_usuarios()
        .get(session.get("username", ""), {})
        .get("comision", 0),
    )

    # Descontar stock automáticamente
    for item in items:
        if item.get("pid"):
            inventario_store.registrar_salida(
                item["pid"],
                item["cantidad"],
                f"Venta {tipo.lower()} {numero}",
                fecha,
                session.get("nombre"),
                referencia=numero,
            )

    flash(f"Comprobante {numero} emitido correctamente.", "success")
    return redirect(url_for("facturas.ver", numero=numero))


@bp.route("/facturas/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    factura = facturas_store.load_facturas().get(numero)
    if not factura:
        flash("El comprobante no existe.", "danger")
        return redirect(url_for("facturas.listar"))
    return render_template("factura.html", factura=factura)


@bp.route("/facturas/<numero>/estado", methods=["POST"])
def cambiar_estado(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    estado = request.form.get("estado", "Pendiente")
    ok, msg = facturas_store.actualizar_estado(numero, estado)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("facturas.ver", numero=numero))


@bp.route("/facturas/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    factura = facturas_store.load_facturas().get(numero)
    ok, msg = facturas_store.eliminar_factura(numero)
    if ok and factura:
        for item in factura.get("items", []):
            pid = item.get("pid")
            if not pid:
                continue
            producto = productos_store.load_productos().get(str(pid), {})
            if not producto.get("control_stock", False):
                continue
            inventario_store.registrar_entrada(
                pid,
                item.get("cantidad", 0),
                f"Anulación de {factura.get('tipo', 'comprobante')} {numero}",
                ahora().strftime("%Y-%m-%d"),
                session.get("nombre"),
                referencia=numero,
            )
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("facturas.listar"))
