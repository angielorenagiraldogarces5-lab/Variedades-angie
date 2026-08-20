from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import clientes_store, facturas_store, fiados_store
from utils import ahora

bp = Blueprint("importar_cobros", __name__)


def _logueado():
    return session.get("logged_in")


def _buscar_cliente_por_nombre(nombre):
    clientes = clientes_store.load_clientes()
    nombre_lower = nombre.strip().lower()
    for cid, c in clientes.items():
        if c.get("nombre", "").strip().lower() == nombre_lower:
            return cid, c
    return None, None


@bp.route("/importar-cobros")
def formulario():
    if not _logueado():
        return redirect(url_for("login.login"))
    if session.get("rol") not in ("Admin", "Dueño"):
        flash("No tenés permisos para acceder a esta sección.", "danger")
        return redirect(url_for("dashboard.dashboard"))

    clientes = clientes_store.load_clientes()
    nombres_clientes = sorted(
        {c.get("nombre", "") for c in clientes.values() if c.get("nombre")}
    )

    return render_template(
        "importar_cobros.html",
        nombres_clientes=nombres_clientes,
        frecuencias=fiados_store.FRECUENCIAS,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
        contador=request.args.get("contador", 0, type=int),
        total_productos=request.args.get("total_productos", 0, type=int),
    )


@bp.route("/importar-cobros", methods=["POST"])
def guardar():
    if not _logueado():
        return redirect(url_for("login.login"))
    if session.get("rol") not in ("Admin", "Dueño"):
        flash("No tenés permisos para acceder a esta sección.", "danger")
        return redirect(url_for("dashboard.dashboard"))

    nombre_cliente = request.form.get("cliente_nombre", "").strip()
    if not nombre_cliente:
        flash("El nombre del cliente es obligatorio.", "danger")
        return redirect(url_for("importar_cobros.formulario"))

    try:
        total = float(request.form.get("total", 0) or 0)
    except ValueError:
        total = 0
    if total <= 0:
        flash("El total de la venta debe ser mayor a cero.", "danger")
        return redirect(url_for("importar_cobros.formulario"))

    documento = request.form.get("cliente_documento", "").strip()
    telefono = request.form.get("cliente_telefono", "").strip()
    direccion = request.form.get("cliente_direccion", "").strip()
    ciudad = request.form.get("ciudad", "").strip()
    articulo = request.form.get("articulo", "").strip()
    try:
        cantidad = int(request.form.get("cantidad", 1) or 1)
    except ValueError:
        cantidad = 1
    if cantidad < 1:
        cantidad = 1
    fecha_venta = request.form.get("fecha_venta", "").strip() or ahora().strftime("%Y-%m-%d")
    vendedor = request.form.get("vendedor", "").strip()

    frecuencia = request.form.get("frecuencia", "Quincenal")
    if frecuencia not in fiados_store.FRECUENCIAS:
        frecuencia = "Quincenal"

    try:
        senia = float(request.form.get("senia", 0) or 0)
    except ValueError:
        senia = 0
    if senia < 0:
        senia = 0

    cliente_id, cliente_existente = _buscar_cliente_por_nombre(nombre_cliente)
    if not cliente_existente:
        ok, cid = clientes_store.crear_cliente(
            nombre=nombre_cliente,
            documento=documento,
            telefono=telefono,
            direccion=direccion,
            limite_credito=total,
        )
        if not ok:
            flash("No se pudo crear el cliente.", "danger")
            return redirect(url_for("importar_cobros.formulario"))
        cliente_id = cid
    cliente_data = clientes_store.buscar_cliente(cliente_id)

    items = []
    if articulo:
        items.append({
            "descripcion": articulo,
            "cantidad": cantidad,
            "precio": total,
        })

    numero_factura = facturas_store.crear_factura(
        tipo="Factura",
        fecha=fecha_venta,
        cliente=cliente_data,
        items=items,
        estado="Pagada",
        observacion=f"Importado manual - {ciudad}" if ciudad else "Importado manual",
        vendedor=vendedor,
        forma_pago="Fiado",
    )

    factura = facturas_store.load_facturas().get(numero_factura)
    if not factura:
        flash("No se pudo crear la factura asociada.", "danger")
        return redirect(url_for("importar_cobros.formulario"))

    numero_fiado = fiados_store.crear_fiado(
        fecha=fecha_venta,
        factura=factura,
        frecuencia=frecuencia,
        fecha_inicio=fecha_venta,
        vendedor=vendedor,
        aprobacion_estado="Aprobado",
        aprobacion_score=0,
        aprobacion_razon="Importado de registro manual",
    )

    abonos_registrados = 0

    if senia > 0:
        ok, msg = fiados_store.registrar_abono(
            numero_fiado, fecha_venta, senia, vendedor or "Sistema"
        )
        if ok:
            abonos_registrados += 1

    idx = 0
    while True:
        fecha_abono = request.form.get(f"abono_fecha_{idx}", "").strip()
        monto_abono_str = request.form.get(f"abono_monto_{idx}", "").strip()
        if not fecha_abono and not monto_abono_str:
            break
        try:
            monto_abono = float(monto_abono_str or 0)
        except ValueError:
            monto_abono = 0
        if monto_abono > 0 and fecha_abono:
            ok, msg = fiados_store.registrar_abono(
                numero_fiado, fecha_abono, monto_abono, vendedor or "Sistema"
            )
            if ok:
                abonos_registrados += 1
        idx += 1

    contador = request.form.get("contador", 0, type=int) + 1
    total_productos = request.form.get("total_productos", 0, type=int) + cantidad

    fiado_final = fiados_store.load_fiados().get(numero_fiado)
    saldo = fiado_final.get("saldo_pendiente", 0) if fiado_final else 0

    flash(
        f"Cobro #{contador} cargado: {nombre_cliente} · {numero_fiado} · "
        f"{cantidad} producto(s) · Saldo: ${saldo:,.2f} · {abonos_registrados} abono(s) registrado(s).",
        "success",
    )

    continuar = request.form.get("accion", "continuar")
    if continuar == "finalizar":
        return redirect(url_for("fiados.listar"))

    return redirect(url_for("importar_cobros.formulario", contador=contador, total_productos=total_productos))
