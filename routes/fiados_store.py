import calendar
import json
import os
from datetime import date, datetime, timedelta

from routes import facturas_store
from utils import formatear_moneda

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "fiados.json")

PREFIJO = "FID"
FRECUENCIAS = ("Semanal", "Quincenal", "Mensual")


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_fiados():
    return _leer_json(DATA_FILE, {})


def save_fiados(fiados):
    _guardar_json(DATA_FILE, fiados)


def generar_numero():
    n = facturas_store._siguiente_correlativo("Fiado")
    return f"{PREFIJO}-{n:04d}"


def _sumar_meses(fecha, meses):
    mes_idx = fecha.month - 1 + meses
    anio = fecha.year + mes_idx // 12
    mes = mes_idx % 12 + 1
    dia = min(fecha.day, calendar.monthrange(anio, mes)[1])
    return fecha.replace(year=anio, month=mes, day=dia)


def _generar_fechas_ruta(inicio, frecuencia):
    fechas = []
    if frecuencia == "Mensual":
        for i in range(1, 13):
            fecha = _sumar_meses(inicio, i)
            fechas.append({
                "fecha": fecha.isoformat(),
                "cobrado": False,
                "fecha_cobro_real": None,
            })
    else:
        dias = 7 if frecuencia == "Semanal" else 15
        n_dates = 52 if frecuencia == "Semanal" else 26
        for i in range(1, n_dates + 1):
            fecha = inicio + timedelta(days=dias * i)
            fechas.append({
                "fecha": fecha.isoformat(),
                "cobrado": False,
                "fecha_cobro_real": None,
            })
    return fechas


def _recalcular_totales(fiado):
    total_pagado = round(
        sum(float(a.get("monto", 0)) for a in fiado.get("abonos", [])), 2
    )
    fiado["total_pagado"] = total_pagado
    fiado["saldo_pendiente"] = round(float(fiado.get("total", 0)) - total_pagado, 2)
    fiado["estado"] = "Pagado" if fiado["saldo_pendiente"] <= 0 else "Pendiente"


def crear_fiado(fecha, factura, frecuencia, fecha_inicio, vendedor,
                aprobacion_estado="Pendiente", aprobacion_score=0, aprobacion_razon=""):
    total = round(float(factura.get("total", 0)), 2)
    inicio = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()

    fechas_ruta = _generar_fechas_ruta(inicio, frecuencia)

    fiado = {
        "numero": generar_numero(),
        "fecha": fecha,
        "factura_origen": factura.get("numero"),
        "cliente": factura.get("cliente", {}),
        "items": factura.get("items", []),
        "total": total,
        "frecuencia": frecuencia,
        "fecha_inicio": fecha_inicio,
        "fechas_ruta": fechas_ruta,
        "abonos": [],
        "total_pagado": 0.0,
        "saldo_pendiente": total,
        "estado": "Pendiente",
        "vendedor": vendedor or "",
        "aprobacion_estado": aprobacion_estado,
        "aprobacion_score": aprobacion_score,
        "aprobacion_razon": aprobacion_razon,
        "reestructurado_de": None,
        "pago_inicial": 0.0,
    }
    fiados = load_fiados()
    fiados[fiado["numero"]] = fiado
    save_fiados(fiados)
    _actualizar_estadisticas_cliente(fiado.get("cliente", {}).get("id"))
    return fiado["numero"]


def registrar_abono(numero, fecha, monto, registrado_por):
    fiados = load_fiados()
    fiado = fiados.get(numero)
    if not fiado:
        return False, "El fiado no existe."

    try:
        monto = round(float(monto), 2)
    except (TypeError, ValueError):
        return False, "Monto inválido."

    saldo = round(float(fiado.get("saldo_pendiente", 0)), 2)
    if monto <= 0:
        return False, "El monto del abono debe ser mayor a cero."
    if monto > saldo:
        return False, f"El abono supera el saldo pendiente ({formatear_moneda(saldo)})."

    fechas_ruta = fiado.get("fechas_ruta", [])
    for fr in fechas_ruta:
        if not fr.get("cobrado"):
            fr["cobrado"] = True
            fr["fecha_cobro_real"] = fecha
            break

    abonos = fiado.setdefault("abonos", [])
    abonos.append(
        {
            "n": len(abonos) + 1,
            "fecha": fecha,
            "monto": monto,
            "registrado_por": registrado_por or "",
        }
    )

    _recalcular_totales(fiado)
    save_fiados(fiados)
    _actualizar_estadisticas_cliente(fiado.get("cliente", {}).get("id"))
    return True, f"Abono de {formatear_moneda(monto)} registrado correctamente."


def aprobar_fiado(numero, estado, razon=""):
    fiados = load_fiados()
    fiado = fiados.get(numero)
    if not fiado:
        return False, "El fiado no existe."
    fiado["aprobacion_estado"] = estado
    fiado["aprobacion_razon"] = razon
    save_fiados(fiados)
    return True, f"Fiado {estado.lower()} correctamente."


def editar_fiado(numero, cliente_nombre=None, cliente_telefono=None,
                 cliente_direccion=None, cliente_documento=None,
                 vendedor=None, frecuencia=None, fecha_inicio=None,
                 observaciones=None):
    fiados = load_fiados()
    fiado = fiados.get(numero)
    if not fiado:
        return False, "El fiado no existe."

    cliente = fiado.get("cliente", {})
    if cliente_nombre is not None:
        cliente["nombre"] = cliente_nombre
    if cliente_telefono is not None:
        cliente["telefono"] = cliente_telefono
    if cliente_direccion is not None:
        cliente["direccion"] = cliente_direccion
    if cliente_documento is not None:
        cliente["documento"] = cliente_documento
    fiado["cliente"] = cliente

    if vendedor is not None:
        fiado["vendedor"] = vendedor
    if observaciones is not None:
        fiado["observaciones"] = observaciones

    recalcular = False
    if frecuencia and frecuencia in FRECUENCIAS and frecuencia != fiado.get("frecuencia"):
        fiado["frecuencia"] = frecuencia
        recalcular = True

    if fecha_inicio and fecha_inicio != fiado.get("fecha_inicio"):
        fiado["fecha_inicio"] = fecha_inicio
        recalcular = True

    if recalcular:
        freq = fiado.get("frecuencia", "Semanal")
        try:
            inicio = datetime.strptime(fiado.get("fecha_inicio", fiado.get("fecha", "")), "%Y-%m-%d").date()
        except ValueError:
            inicio = date.today()
        fiado["fechas_ruta"] = _generar_fechas_ruta(inicio, freq)

    save_fiados(fiados)
    _actualizar_estadisticas_cliente(fiado.get("cliente", {}).get("id"))
    return True, "Fiado actualizado correctamente."


def eliminar_fiado(numero):
    fiados = load_fiados()
    if numero not in fiados:
        return False, "El fiado no existe."
    fiado = fiados[numero]
    del fiados[numero]
    save_fiados(fiados)
    _actualizar_estadisticas_cliente(fiado.get("cliente", {}).get("id"))
    return True, "Fiado eliminado correctamente."


def _actualizar_estadisticas_cliente(cliente_id):
    if not cliente_id:
        return
    from routes import scoring
    scoring.actualizar_credito_cliente(cliente_id)
    scoring.actualizar_estado_moroso(cliente_id)

    fiados = load_fiados()
    total = 0
    pagados = 0
    con_mora = 0
    hoy = date.today()
    for f in fiados.values():
        if str(f.get("cliente", {}).get("id", "")) != str(cliente_id):
            continue
        total += 1
        if f.get("estado") == "Pagado":
            pagados += 1
        else:
            for fr in f.get("fechas_ruta", []):
                if fr.get("cobrado"):
                    continue
                try:
                    fecha_limite = date.fromisoformat(fr.get("fecha", ""))
                except (TypeError, ValueError):
                    continue
                if fecha_limite < hoy:
                    con_mora = 1
                    break

    from routes import clientes_store
    clientes = clientes_store.load_clientes()
    cid = str(cliente_id)
    if cid in clientes:
        clientes[cid]["total_fiados"] = total
        clientes[cid]["fiados_pagados"] = pagados
        clientes[cid]["fiados_con_mora"] = con_mora
        clientes_store.save_clientes(clientes)
