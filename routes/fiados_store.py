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


def _fecha_limite(fecha_inicio, frecuencia, n):
    if frecuencia == "Mensual":
        return _sumar_meses(fecha_inicio, n).isoformat()
    dias = 7 if frecuencia == "Semanal" else 15
    return (fecha_inicio + timedelta(days=dias * n)).isoformat()


def _generar_fechas_ruta(inicio, frecuencia, n_cuotas, monto_cuota):
    fechas = []
    for i in range(1, n_cuotas + 1):
        fechas.append({
            "fecha": _fecha_limite(inicio, frecuencia, i),
            "cuota_n": i,
            "monto": monto_cuota,
            "cobrado": False,
            "fecha_cobro_real": None,
        })
    return fechas


def _recalcular_totales(fiado):
    total_pagado = round(
        sum(float(c.get("monto_abonado", 0)) for c in fiado.get("cuotas", [])), 2
    )
    fiado["total_pagado"] = total_pagado
    fiado["saldo_pendiente"] = round(float(fiado.get("total", 0)) - total_pagado, 2)
    todas_pagadas = all(c.get("estado") == "Pagada" for c in fiado.get("cuotas", []))
    fiado["estado"] = "Pagado" if todas_pagadas else "Pendiente"


def crear_fiado(fecha, factura, n_cuotas, frecuencia, fecha_inicio, vendedor,
                aprobacion_estado="Pendiente", aprobacion_score=0, aprobacion_razon=""):
    total = round(float(factura.get("total", 0)), 2)
    if n_cuotas < 1:
        n_cuotas = 1
    base = round(total / n_cuotas, 2)
    inicio = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()

    cuotas = []
    acumulado = 0.0
    for i in range(1, n_cuotas + 1):
        monto = round(total - acumulado, 2) if i == n_cuotas else base
        acumulado = round(acumulado + monto, 2)
        cuotas.append(
            {
                "n": i,
                "monto": monto,
                "monto_abonado": 0.0,
                "fecha_limite": _fecha_limite(inicio, frecuencia, i),
                "fecha_pago": None,
                "estado": "Pendiente",
            }
        )

    fechas_ruta = _generar_fechas_ruta(inicio, frecuencia, n_cuotas, base)

    fiado = {
        "numero": generar_numero(),
        "fecha": fecha,
        "factura_origen": factura.get("numero"),
        "cliente": factura.get("cliente", {}),
        "items": factura.get("items", []),
        "total": total,
        "n_cuotas": n_cuotas,
        "frecuencia": frecuencia,
        "fecha_inicio": fecha_inicio,
        "cuotas": cuotas,
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

    restante = monto
    cuotas = fiado.get("cuotas", [])
    for c in cuotas:
        if c.get("estado") == "Pagada" or restante <= 0:
            continue
        pendiente_cuota = round(float(c.get("monto", 0)) - float(c.get("monto_abonado", 0)), 2)
        if pendiente_cuota <= 0:
            continue
        aplicar = round(min(restante, pendiente_cuota), 2)
        c["monto_abonado"] = round(float(c.get("monto_abonado", 0)) + aplicar, 2)
        restante = round(restante - aplicar, 2)
        if c["monto_abonado"] >= float(c.get("monto", 0)) - 0.005:
            c["monto_abonado"] = float(c.get("monto", 0))
            c["estado"] = "Pagada"
            c["fecha_pago"] = fecha

    fechas_ruta = fiado.get("fechas_ruta", [])
    for fr in fechas_ruta:
        if not fr.get("cobrado") and float(fr.get("monto", 0)) <= monto + 0.005:
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
        try:
            inicio = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()
            fiado["fecha_inicio"] = fecha_inicio
            recalcular = True
        except ValueError:
            pass

    if recalcular:
        freq = fiado.get("frecuencia", "Semanal")
        try:
            inicio = datetime.strptime(fiado.get("fecha_inicio", fiado.get("fecha", "")), "%Y-%m-%d").date()
        except ValueError:
            inicio = date.today()

        for c in fiado.get("cuotas", []):
            if c.get("estado") != "Pagada":
                c["fecha_limite"] = _fecha_limite(inicio, freq, c["n"])

        for fr in fiado.get("fechas_ruta", []):
            if not fr.get("cobrado"):
                fr["fecha"] = _fecha_limite(inicio, freq, fr.get("cuota_n", 1))

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
    for f in fiados.values():
        if str(f.get("cliente", {}).get("id", "")) != str(cliente_id):
            continue
        total += 1
        if f.get("estado") == "Pagado":
            pagados += 1
        else:
            for c in f.get("cuotas", []):
                if c.get("estado") != "Pagada":
                    fecha_limite = None
                    try:
                        fecha_limite = date.fromisoformat(c.get("fecha_limite", ""))
                    except (TypeError, ValueError):
                        pass
                    if fecha_limite and fecha_limite < date.today():
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
