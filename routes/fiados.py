from datetime import date, timedelta

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import facturas_store, fiados_store
from utils import ahora

bp = Blueprint("fiados", __name__)


def _logueado():
    return session.get("logged_in")


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


def _alertas_vencimiento(fiados, dias_proximas=7):
    hoy = date.today()
    vencidas, proximas = [], []
    for numero, f in fiados.items():
        if f.get("estado") == "Pagado":
            continue
        cliente = f.get("cliente", {}).get("nombre", "Sin nombre")
        for c in f.get("cuotas", []):
            if c.get("estado") == "Pagada":
                continue
            fecha_limite = _parsear_fecha(c.get("fecha_limite"))
            if not fecha_limite:
                continue
            saldo_cuota = round(float(c.get("monto", 0)) - float(c.get("monto_abonado", 0)), 2)
            dias = (fecha_limite - hoy).days
            if dias < 0:
                vencidas.append({
                    "fiado": numero,
                    "cuota": c.get("n"),
                    "cliente": cliente,
                    "monto": saldo_cuota,
                    "fecha_limite": c.get("fecha_limite"),
                    "dias": -dias,
                })
            elif dias <= dias_proximas:
                proximas.append({
                    "fiado": numero,
                    "cuota": c.get("n"),
                    "cliente": cliente,
                    "monto": saldo_cuota,
                    "fecha_limite": c.get("fecha_limite"),
                    "dias": dias,
                })
    vencidas.sort(key=lambda a: a["dias"], reverse=True)
    proximas.sort(key=lambda a: a["dias"])
    return vencidas, proximas


def _resumen_por_cliente(fiados):
    resumen = {}
    for f in fiados.values():
        nombre = f.get("cliente", {}).get("nombre", "Sin nombre")
        r = resumen.setdefault(
            nombre,
            {"nombre": nombre, "fiados": 0, "total": 0.0, "saldo": 0.0, "cuotas_pendientes": 0},
        )
        r["fiados"] += 1
        r["total"] = round(r["total"] + float(f.get("total", 0)), 2)
        r["saldo"] = round(r["saldo"] + float(f.get("saldo_pendiente", 0)), 2)
        for c in f.get("cuotas", []):
            if c.get("estado") != "Pagada":
                r["cuotas_pendientes"] += 1
    return sorted(resumen.values(), key=lambda r: r["saldo"], reverse=True)


def _fiados_recientes(fiados, cantidad=6):
    ordenados = sorted(
        fiados.items(), key=lambda kv: _parsear_fecha(kv[1].get("fecha")) or date.min, reverse=True
    )
    return ordenados[:cantidad]


def _fiados_existentes():
    return {
        f.get("factura_origen")
        for f in fiados_store.load_fiados().values()
        if f.get("factura_origen")
    }


def _anos_disponibles(fiados):
    anos = set()
    for f in fiados.values():
        fecha = _parsear_fecha(f.get("fecha"))
        if fecha:
            anos.add(fecha.year)
    return sorted(anos, reverse=True)


def _filtrar_por_anio(fiados, anio):
    if not anio:
        return fiados
    resultado = {}
    for numero, f in fiados.items():
        fecha = _parsear_fecha(f.get("fecha"))
        if fecha and fecha.year == anio:
            resultado[numero] = f
    return resultado


@bp.route("/fiados")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    fiados_todos = fiados_store.load_fiados()
    anio_filtro = request.args.get("anio", "").strip()
    try:
        anio_filtro = int(anio_filtro) if anio_filtro else None
    except ValueError:
        anio_filtro = None
    fiados = _filtrar_por_anio(fiados_todos, anio_filtro)
    anos_disponibles = _anos_disponibles(fiados_todos)
    vencidas, proximas = _alertas_vencimiento(fiados)
    return render_template(
        "fiados.html",
        fiados=fiados,
        vencidas=vencidas,
        proximas=proximas,
        recientes=_fiados_recientes(fiados),
        resumen_clientes=_resumen_por_cliente(fiados),
        rol=session.get("rol"),
        anio_filtro=anio_filtro,
        anos_disponibles=anos_disponibles,
    )


@bp.route("/fiados/nuevo")
def nuevo():
    if not _logueado():
        return redirect(url_for("login.login"))
    facturas = facturas_store.load_facturas()
    con_fiado = _fiados_existentes()
    disponibles = {
        numero: f
        for numero, f in facturas.items()
        if numero not in con_fiado
    }
    seleccionada = request.args.get("factura", "").strip()
    factura = disponibles.get(seleccionada)
    return render_template(
        "nuevo_fiado.html",
        facturas=disponibles,
        factura=factura,
        frecuencias=fiados_store.FRECUENCIAS,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/fiados/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    factura_numero = request.form.get("factura_numero", "").strip()
    factura = facturas_store.load_facturas().get(factura_numero)
    if not factura:
        flash("Debe seleccionar una factura o boleta válida.", "danger")
        return redirect(url_for("fiados.nuevo"))
    if factura_numero in _fiados_existentes():
        flash("Ese comprobante ya tiene un fiado registrado.", "danger")
        return redirect(url_for("fiados.nuevo"))

    try:
        n_cuotas = int(request.form.get("n_cuotas", 1) or 1)
    except ValueError:
        n_cuotas = 1
    if n_cuotas < 1:
        n_cuotas = 1

    frecuencia = request.form.get("frecuencia", "Semanal")
    if frecuencia not in fiados_store.FRECUENCIAS:
        frecuencia = "Semanal"

    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    fecha_inicio = request.form.get("fecha_inicio", "").strip() or fecha

    numero = fiados_store.crear_fiado(
        fecha,
        factura,
        n_cuotas,
        frecuencia,
        fecha_inicio,
        session.get("nombre"),
    )

    flash(f"Fiado {numero} creado correctamente.", "success")
    return redirect(url_for("fiados.ver", numero=numero))


@bp.route("/fiados/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    fiado = fiados_store.load_fiados().get(numero)
    if not fiado:
        flash("El fiado no existe.", "danger")
        return redirect(url_for("fiados.listar"))
    factura = facturas_store.load_facturas().get(fiado.get("factura_origen"))
    return render_template(
        "fiado.html",
        fiado=fiado,
        factura=factura,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/fiados/<numero>/tarjeta")
def tarjeta(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    fiado = fiados_store.load_fiados().get(numero)
    if not fiado:
        flash("El fiado no existe.", "danger")
        return redirect(url_for("fiados.listar"))
    dias_semana = {
        0: "Lunes", 1: "Martes", 2: "Miércoles", 3: "Jueves",
        4: "Viernes", 5: "Sábado", 6: "Domingo",
    }
    frecuencia = fiado.get("frecuencia", "Semanal")
    fecha_inicio = _parsear_fecha(fiado.get("fecha_inicio"))
    if fecha_inicio and frecuencia == "Semanal":
        dia_pago = dias_semana.get(fecha_inicio.weekday(), "—")
        dias_pago = f"Todo {dia_pago}"
    elif fecha_inicio and frecuencia == "Quincenal":
        dia = fecha_inicio.day
        dias_pago = f"Días {dia} y {dia + 15 if dia + 15 <= 28 else dia - 15} de cada mes"
    elif fecha_inicio and frecuencia == "Mensual":
        dia = fecha_inicio.day
        dias_pago = f"Día {dia} de cada mes"
    else:
        dias_pago = "Según calendario"
    return render_template(
        "tarjeta_cobro.html",
        fiado=fiado,
        ciudad="Mendoza",
        dias_pago=dias_pago,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/fiados/<numero>/abono", methods=["POST"])
def abonar(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    monto = request.form.get("monto", "").strip()
    ok, msg = fiados_store.registrar_abono(numero, fecha, monto, session.get("nombre"))
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("fiados.ver", numero=numero))


@bp.route("/fiados/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = fiados_store.eliminar_fiado(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("fiados.listar"))
