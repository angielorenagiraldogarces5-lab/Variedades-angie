from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import facturas_store, inventario_store, notas_credito_store
from utils import ahora

bp = Blueprint("notas_credito", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/notas-credito")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    notas = notas_credito_store.load_notas()
    return render_template(
        "notas_credito.html",
        notas=notas,
        rol=session.get("rol"),
    )


@bp.route("/notas-credito/nueva")
def nueva():
    if not _logueado():
        return redirect(url_for("login.login"))
    facturas = facturas_store.load_facturas()
    seleccionada = request.args.get("factura", "").strip()
    factura = None
    devuelto = {}
    if seleccionada and seleccionada in facturas:
        factura = facturas[seleccionada]
        devuelto = notas_credito_store.cantidad_devuelta_por_item(seleccionada)
    return render_template(
        "nueva_nota_credito.html",
        facturas=facturas,
        factura=factura,
        devuelto=devuelto,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/notas-credito/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    factura_numero = request.form.get("factura_numero", "").strip()
    facturas = facturas_store.load_facturas()
    if factura_numero not in facturas:
        flash("Debe seleccionar una factura válida.", "danger")
        return redirect(url_for("notas_credito.nueva"))
    factura = facturas[factura_numero]

    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    motivo = request.form.get("motivo", "").strip()
    observacion = request.form.get("observacion", "").strip()

    indices = set(request.form.getlist("devolver[]"))
    cantidades = request.form.getlist("cantidad_devolver[]")
    devuelto = notas_credito_store.cantidad_devuelta_por_item(factura_numero)

    items = []
    for i, item in enumerate(factura.get("items", [])):
        if str(i) not in indices:
            continue
        try:
            cantidad = float(cantidades[i] or 0)
        except (ValueError, IndexError):
            cantidad = 0
        desc = item.get("descripcion", "")
        precio = float(item.get("precio", 0))
        disponible = round(float(item.get("cantidad", 0)) - devuelto.get(desc, 0), 2)
        if cantidad <= 0:
            continue
        if cantidad > disponible:
            flash(
                f"La cantidad a devolver de '{desc}' supera el disponible ({disponible}).",
                "danger",
            )
            return redirect(url_for("notas_credito.nueva", factura=factura_numero))
        items.append(
            {
                "descripcion": desc,
                "cantidad": round(cantidad, 2),
                "precio": round(precio, 2),
                "subtotal": round(cantidad * precio, 2),
                "pid": item.get("pid"),
            }
        )

    if not items:
        flash("Debe marcar al menos un ítem con cantidad a devolver.", "danger")
        return redirect(url_for("notas_credito.nueva", factura=factura_numero))

    numero = notas_credito_store.crear_nota(
        fecha,
        factura_numero,
        factura.get("cliente", {}),
        items,
        motivo,
        observacion,
        session.get("nombre"),
    )

    # Reponer stock de los productos devueltos
    for item in items:
        pid = item.get("pid")
        if not pid:
            continue
        ok, _ = inventario_store.registrar_entrada(
            pid,
            item["cantidad"],
            f"Devolución {numero}",
            fecha,
            session.get("nombre"),
            referencia=numero,
        )
        if not ok:
            flash("No se pudo reponer el stock de uno de los productos.", "danger")

    flash(f"Nota de crédito {numero} emitida correctamente.", "success")
    return redirect(url_for("notas_credito.ver", numero=numero))


@bp.route("/notas-credito/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    nota = notas_credito_store.load_notas().get(numero)
    if not nota:
        flash("La nota de crédito no existe.", "danger")
        return redirect(url_for("notas_credito.listar"))
    factura = facturas_store.load_facturas().get(nota.get("factura_origen"))
    return render_template("nota_credito.html", nota=nota, factura=factura)


@bp.route("/notas-credito/<numero>/estado", methods=["POST"])
def cambiar_estado(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    estado = request.form.get("estado", "Pendiente")
    ok, msg = notas_credito_store.actualizar_estado(numero, estado)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("notas_credito.ver", numero=numero))


@bp.route("/notas-credito/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    nota = notas_credito_store.load_notas().get(numero)
    ok, msg = notas_credito_store.eliminar_nota(numero)
    if ok and nota:
        fecha = ahora().strftime("%Y-%m-%d")
        for item in nota.get("items", []):
            pid = item.get("pid")
            if not pid:
                continue
            inventario_store.registrar_salida(
                pid,
                item.get("cantidad", 0),
                f"Anulación de nota de crédito {numero}",
                fecha,
                session.get("nombre"),
                referencia=numero,
            )
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("notas_credito.listar"))
