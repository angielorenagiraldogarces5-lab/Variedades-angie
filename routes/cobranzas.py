import calendar
from collections import defaultdict
from datetime import date, timedelta

from flask import Blueprint, redirect, render_template, request, session, url_for

from routes import fiados_store

bp = Blueprint("cobranzas", __name__)


def _logueado():
    return session.get("logged_in")


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


def _dias_semana_corto():
    return {0: "Lun", 1: "Mar", 2: "Mié", 3: "Jue", 4: "Vie", 5: "Sáb", 6: "Dom"}


def _dias_semana_largo():
    return {0: "Lunes", 1: "Martes", 2: "Miércoles", 3: "Jueves", 4: "Viernes", 5: "Sábado", 6: "Domingo"}


def _generar_calendario(anio, mes):
    """Genera la grilla del mes con días y空 slots."""
    _, dias_mes = calendar.monthrange(anio, mes)
    primer_dia = date(anio, mes, 1).weekday()
    celdas = [None] * primer_dia
    for d in range(1, dias_mes + 1):
        celdas.append(d)
    while len(celdas) % 7 != 0:
        celdas.append(None)
    return celdas


def _cobros_por_dia(fiados, anio, mes):
    """Recorre las cuotas pendientes y las agrupa por fecha límite dentro del mes."""
    hoy = date.today()
    por_dia = defaultdict(list)
    for numero, f in fiados.items():
        if f.get("estado") == "Pagado":
            continue
        cliente = f.get("cliente", {}).get("nombre", "Sin nombre")
        cliente_tel = f.get("cliente", {}).get("telefono", "")
        for c in f.get("cuotas", []):
            if c.get("estado") == "Pagada":
                continue
            fecha_limite = _parsear_fecha(c.get("fecha_limite"))
            if not fecha_limite:
                continue
            if fecha_limite.year == anio and fecha_limite.month == mes:
                saldo = round(float(c.get("monto", 0)) - float(c.get("monto_abonado", 0)), 2)
                if saldo <= 0:
                    continue
                por_dia[fecha_limite.day].append({
                    "fiado": numero,
                    "cuota": c.get("n"),
                    "cliente": cliente,
                    "telefono": cliente_tel,
                    "monto": saldo,
                    "fecha_limite": fecha_limite,
                    "vencida": fecha_limite < hoy,
                    "hoy": fecha_limite == hoy,
                    "frecuencia": f.get("frecuencia", ""),
                })
    return dict(por_dia)


def _proximo_pago(fecha_inicio_str, frecuencia, hoy):
    """Calcula la próxima fecha de pago a partir de hoy."""
    inicio = _parsear_fecha(fecha_inicio_str)
    if not inicio:
        return None
    if frecuencia == "Semanal":
        dias_desde_inicio = (hoy - inicio).days
        semanas_pasadas = dias_desde_inicio // 7
        proximo = inicio + timedelta(weeks=semanas_pasadas + 1)
        if proximo < hoy:
            proximo += timedelta(weeks=1)
        return proximo
    elif frecuencia == "Quincenal":
        dias_desde_inicio = (hoy - inicio).days
        quincenas_pasadas = dias_desde_inicio // 15
        proximo = inicio + timedelta(days=15 * (quincenas_pasadas + 1))
        if proximo < hoy:
            proximo += timedelta(days=15)
        return proximo
    elif frecuencia == "Mensual":
        dia_pago = inicio.day
        mes = hoy.month
        anio = hoy.year
        try:
            candidato = date(anio, mes, dia_pago)
        except ValueError:
            ultimo_dia = calendar.monthrange(anio, mes)[1]
            candidato = date(anio, mes, ultimo_dia)
        if candidato < hoy:
            mes += 1
            if mes > 12:
                mes = 1
                anio += 1
            ultimo_dia = calendar.monthrange(anio, mes)[1]
            dia_real = min(dia_pago, ultimo_dia)
            candidato = date(anio, mes, dia_real)
        return candidato
    return None


@bp.route("/cobranzas")
def calendario():
    if not _logueado():
        return redirect(url_for("login.login"))

    hoy = date.today()
    anio_param = request.args.get("anio", "").strip()
    mes_param = request.args.get("mes", "").strip()

    try:
        anio = int(anio_param) if anio_param else hoy.year
    except ValueError:
        anio = hoy.year
    try:
        mes = int(mes_param) if mes_param else hoy.month
    except ValueError:
        mes = hoy.month

    if mes < 1:
        mes = 12
        anio -= 1
    elif mes > 12:
        mes = 1
        anio += 1

    nombre_mes = calendar.month_name[mes]
    celdas = _generar_calendario(anio, mes)
    fiados = fiados_store.load_fiados()
    cobros = _cobros_por_dia(fiados, anio, mes)

    total_cobrar = sum(
        sum(item["monto"] for item in items)
        for items in cobros.values()
    )
    total_operaciones = sum(len(items) for items in cobros.values())

    dias_semana_largo = _dias_semana_largo()

    hoy_str = hoy.isoformat()
    return render_template(
        "cobranzas.html",
        anio=anio,
        mes=mes,
        nombre_mes=nombre_mes,
        celdas=celdas,
        cobros=cobros,
        hoy=hoy,
        hoy_str=hoy_str,
        total_cobrar=round(total_cobrar, 2),
        total_operaciones=total_operaciones,
        dias_semana=dias_semana_largo,
    )


def _deuda_envejecida(fiados):
    hoy = date.today()
    clientes = {}
    for numero, f in fiados.items():
        if f.get("estado") == "Pagado":
            continue
        cid = str(f.get("cliente", {}).get("id", ""))
        nombre = f.get("cliente", {}).get("nombre", "Sin nombre")
        telefono = f.get("cliente", {}).get("telefono", "")
        direccion = f.get("cliente", {}).get("direccion", "")
        for c in f.get("cuotas", []):
            if c.get("estado") == "Pagada":
                continue
            fecha_limite = _parsear_fecha(c.get("fecha_limite"))
            if not fecha_limite:
                continue
            saldo = round(float(c.get("monto", 0)) - float(c.get("monto_abonado", 0)), 2)
            if saldo <= 0:
                continue
            dias = (hoy - fecha_limite).days
            if dias <= 0:
                continue
            rango = "30" if dias <= 30 else ("60" if dias <= 60 else ("90" if dias <= 90 else "90+"))
            cl = clientes.setdefault(cid, {
                "id": cid, "nombre": nombre, "telefono": telefono, "direccion": direccion,
                "deuda_total": 0.0, "items": [], "max_dias": 0,
            })
            cl["deuda_total"] = round(cl["deuda_total"] + saldo, 2)
            cl["items"].append({
                "fiado": numero, "cuota": c.get("n"), "monto": saldo,
                "fecha_limite": c.get("fecha_limite"), "dias": dias, "rango": rango,
            })
            cl["max_dias"] = max(cl["max_dias"], dias)
    return sorted(clientes.values(), key=lambda c: c["max_dias"], reverse=True)


@bp.route("/reporte-deuda")
def reporte_deuda():
    if not _logueado():
        return redirect(url_for("login.login"))
    fiados = fiados_store.load_fiados()
    clientes = _deuda_envejecida(fiados)

    rangos = {"30": [], "60": [], "90": [], "90+": []}
    total_general = 0.0
    for cl in clientes:
        for item in cl["items"]:
            rangos[item["rango"]].append({**item, "cliente": cl["nombre"], "telefono": cl["telefono"], "direccion": cl["direccion"]})
            total_general += item["monto"]

    resumen_rangos = {}
    for rango, items in rangos.items():
        monto = sum(it["monto"] for it in items)
        resumen_rangos[rango] = {"cantidad": len(items), "monto": round(monto, 2)}

    return render_template(
        "reporte_deuda.html",
        clientes=clientes,
        rangos=rangos,
        resumen_rangos=resumen_rangos,
        total_general=round(total_general, 2),
    )


@bp.route("/morosos")
def morosos():
    if not _logueado():
        return redirect(url_for("login.login"))
    fiados = fiados_store.load_fiados()
    clientes = _deuda_envejecida(fiados)
    morosos = [c for c in clientes if c["max_dias"] > 30]
    total_morosos = round(sum(c["deuda_total"] for c in morosos), 2)
    return render_template(
        "morosos.html",
        morosos=morosos,
        total_morosos=total_morosos,
    )
