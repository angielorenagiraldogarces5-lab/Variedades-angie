from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import facturas_store, fiados_store, pagares_store
from utils import ahora

bp = Blueprint("pagares", __name__)


def _logueado():
    return session.get("logged_in")


def _vencimiento_por_cuotas(fiado):
    fechas = [
        fr.get("fecha", "")
        for fr in fiado.get("fechas_ruta", [])
        if fr.get("fecha")
    ]
    return max(fechas) if fechas else ""


@bp.route("/pagares")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    return render_template(
        "pagares.html",
        pagares=pagares_store.load_pagares(),
        rol=session.get("rol"),
    )


@bp.route("/pagares/nuevo")
def nuevo():
    if not _logueado():
        return redirect(url_for("login.login"))

    origen = request.args.get("origen", "manual").strip()
    if origen not in ("manual", "fiado", "factura"):
        origen = "manual"
    numero_origen = request.args.get("numero", "").strip()

    fiados = fiados_store.load_fiados()
    facturas = facturas_store.load_facturas()

    seleccion = {}
    if origen == "fiado" and numero_origen in fiados:
        fiado = fiados[numero_origen]
        seleccion = {
            "origen": origen,
            "numero": numero_origen,
            "cliente": fiado.get("cliente", {}),
            "monto": fiado.get("total", 0),
            "vencimiento": _vencimiento_por_cuotas(fiado),
            "items": fiado.get("items", []),
        }
    elif origen == "factura" and numero_origen in facturas:
        factura = facturas[numero_origen]
        seleccion = {
            "origen": origen,
            "numero": numero_origen,
            "cliente": factura.get("cliente", {}),
            "monto": factura.get("total", 0),
            "vencimiento": "",
            "items": factura.get("items", []),
        }

    return render_template(
        "nuevo_pagare.html",
        fiados=fiados,
        facturas=facturas,
        seleccion=seleccion,
        origen=origen,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
        moneda=pagares_store.MONEDA,
    )


@bp.route("/pagares/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    origen = request.form.get("origen", "manual").strip()
    if origen not in ("manual", "fiado", "factura"):
        origen = "manual"
    numero_origen = request.form.get("origen_numero", "").strip()

    cliente = {
        "nombre": request.form.get("cliente_nombre", "").strip(),
        "documento": request.form.get("cliente_documento", "").strip(),
        "telefono": request.form.get("cliente_telefono", "").strip(),
        "direccion": request.form.get("cliente_direccion", "").strip(),
    }
    acreedor = {
        "nombre": request.form.get("acreedor_nombre", "").strip(),
        "documento": request.form.get("acreedor_documento", "").strip(),
        "telefono": request.form.get("acreedor_telefono", "").strip(),
        "direccion": request.form.get("acreedor_direccion", "").strip(),
    }

    if not cliente.get("nombre") and origen == "fiado":
        fiado = fiados_store.load_fiados().get(numero_origen)
        if not fiado:
            flash("Debe seleccionar un fiado válido.", "danger")
            return redirect(url_for("pagares.nuevo"))
        cliente = fiado.get("cliente", {})
    if not cliente.get("nombre") and origen == "factura":
        factura = facturas_store.load_facturas().get(numero_origen)
        if not factura:
            flash("Debe seleccionar una factura o boleta válida.", "danger")
            return redirect(url_for("pagares.nuevo"))
        cliente = factura.get("cliente", {})

    if not cliente.get("nombre"):
        flash("El nombre del deudor es obligatorio.", "danger")
        return redirect(url_for("pagares.nuevo", origen=origen, numero=numero_origen))

    monto = request.form.get("monto", "").strip()
    if not monto:
        if origen == "fiado":
            fiado = fiados_store.load_fiados().get(numero_origen)
            monto = fiado.get("total", 0) if fiado else 0
        elif origen == "factura":
            factura = facturas_store.load_facturas().get(numero_origen)
            monto = factura.get("total", 0) if factura else 0

    detalle_origen = None
    if origen == "fiado":
        detalle_origen = {"tipo": "Fiado", "numero": numero_origen}
    elif origen == "factura":
        detalle_origen = {"tipo": "Factura/Boleta", "numero": numero_origen}

    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    lugar = request.form.get("lugar", "").strip()
    interes = request.form.get("interes", "0").strip() or "0"
    fecha_vencimiento = request.form.get("fecha_vencimiento", "").strip()
    observacion = request.form.get("observacion", "").strip()

    numero = pagares_store.crear_pagare(
        fecha,
        lugar,
        cliente,
        acreedor,
        monto,
        interes,
        fecha_vencimiento,
        detalle_origen,
        observacion,
        session.get("nombre"),
    )

    flash(f"Pagaré {numero} creado correctamente.", "success")
    return redirect(url_for("pagares.ver", numero=numero))


@bp.route("/pagares/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    pagare = pagares_store.load_pagares().get(numero)
    if not pagare:
        flash("El pagaré no existe.", "danger")
        return redirect(url_for("pagares.listar"))
    return render_template(
        "pagare.html",
        pagare=pagare,
        moneda=pagares_store.MONEDA,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/pagares/<numero>/estado", methods=["POST"])
def cambiar_estado(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    estado = request.form.get("estado", "").strip()
    ok, msg = pagares_store.actualizar_estado(numero, estado)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("pagares.ver", numero=numero))


@bp.route("/pagares/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = pagares_store.eliminar_pagare(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("pagares.listar"))
