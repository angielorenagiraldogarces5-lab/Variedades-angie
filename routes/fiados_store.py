import calendar
import json
import os
from datetime import datetime, timedelta

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


def _recalcular_totales(fiado):
    total_pagado = round(
        sum(float(c.get("monto_abonado", 0)) for c in fiado.get("cuotas", [])), 2
    )
    fiado["total_pagado"] = total_pagado
    fiado["saldo_pendiente"] = round(float(fiado.get("total", 0)) - total_pagado, 2)
    todas_pagadas = all(c.get("estado") == "Pagada" for c in fiado.get("cuotas", []))
    fiado["estado"] = "Pagado" if todas_pagadas else "Pendiente"


def crear_fiado(fecha, factura, n_cuotas, frecuencia, fecha_inicio, vendedor):
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
        "abonos": [],
        "total_pagado": 0.0,
        "saldo_pendiente": total,
        "estado": "Pendiente",
        "vendedor": vendedor or "",
    }
    fiados = load_fiados()
    fiados[fiado["numero"]] = fiado
    save_fiados(fiados)
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

    # Distribuir el abono sobre las cuotas pendientes en orden
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
    return True, f"Abono de {formatear_moneda(monto)} registrado correctamente."


def eliminar_fiado(numero):
    fiados = load_fiados()
    if numero not in fiados:
        return False, "El fiado no existe."
    del fiados[numero]
    save_fiados(fiados)
    return True, "Fiado eliminado correctamente."
