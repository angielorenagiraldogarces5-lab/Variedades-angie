import json
import os

from routes import facturas_store
from utils import ahora, formatear_moneda

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "caja.json")

PREFIJO = "CJ"
ESTADOS = ("Abierta", "Cerrada")

CONCEPTOS_INGRESO = (
    "Venta de contado",
    "Abono de fiado",
    "Otro ingreso",
)

CONCEPTOS_EGRESO = (
    "Gasto operativo",
    "Retiro de caja",
    "Pago a proveedor",
    "Otro egreso",
)


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_cajas():
    return _leer_json(DATA_FILE, {})


def save_cajas(cajas):
    _guardar_json(DATA_FILE, cajas)


def generar_numero():
    n = facturas_store._siguiente_correlativo("Caja")
    return f"{PREFIJO}-{n:04d}"


def caja_abierta():
    for c in load_cajas().values():
        if c.get("estado") == "Abierta":
            return c
    return None


def _recalcular_totales(caja):
    total_ingresos = 0.0
    total_egresos = 0.0
    for m in caja.get("movimientos", []):
        monto = float(m.get("monto", 0))
        if m.get("tipo") == "Ingreso":
            total_ingresos = round(total_ingresos + monto, 2)
        else:
            total_egresos = round(total_egresos + monto, 2)
    caja["total_ingresos"] = total_ingresos
    caja["total_egresos"] = total_egresos
    caja["total_esperado"] = round(
        float(caja.get("monto_inicial", 0)) + total_ingresos - total_egresos, 2
    )


def abrir_caja(fecha, monto_inicial, cajero, observacion=""):
    if caja_abierta():
        return False, "Ya existe una caja abierta. Debe cerrarla antes de abrir otra."
    try:
        monto_inicial = round(float(monto_inicial), 2)
    except (TypeError, ValueError):
        return False, "Monto inicial inválido."
    if monto_inicial < 0:
        return False, "El monto inicial no puede ser negativo."

    numero = generar_numero()
    caja = {
        "numero": numero,
        "fecha": fecha,
        "apertura": ahora().strftime("%Y-%m-%d %H:%M"),
        "cierre": None,
        "cajero": cajero or "",
        "monto_inicial": monto_inicial,
        "movimientos": [],
        "total_ingresos": 0.0,
        "total_egresos": 0.0,
        "total_esperado": monto_inicial,
        "monto_contado": None,
        "diferencia": 0.0,
        "estado": "Abierta",
        "observacion": observacion or "",
        "observacion_cierre": "",
        "cerrado_por": "",
    }
    cajas = load_cajas()
    cajas[numero] = caja
    save_cajas(cajas)
    return True, numero


def registrar_movimiento(numero, tipo, concepto, monto, registrado_por):
    cajas = load_cajas()
    caja = cajas.get(numero)
    if not caja:
        return False, "La caja no existe."
    if caja.get("estado") != "Abierta":
        return False, "La caja está cerrada; no se pueden registrar movimientos."
    if tipo not in ("Ingreso", "Egreso"):
        return False, "Tipo de movimiento inválido."

    try:
        monto = round(float(monto), 2)
    except (TypeError, ValueError):
        return False, "Monto inválido."
    if monto <= 0:
        return False, "El monto debe ser mayor a cero."
    if not concepto.strip():
        return False, "Debe indicar un concepto."

    movimientos = caja.setdefault("movimientos", [])
    movimientos.append(
        {
            "n": len(movimientos) + 1,
            "fecha": ahora().strftime("%Y-%m-%d %H:%M"),
            "tipo": tipo,
            "concepto": concepto.strip(),
            "monto": monto,
            "registrado_por": registrado_por or "",
        }
    )
    _recalcular_totales(caja)
    save_cajas(cajas)
    return True, f"{tipo} de {formatear_moneda(monto)} registrado correctamente."


def eliminar_movimiento(numero, n):
    cajas = load_cajas()
    caja = cajas.get(numero)
    if not caja:
        return False, "La caja no existe."
    if caja.get("estado") != "Abierta":
        return False, "La caja está cerrada; no se pueden eliminar movimientos."
    try:
        n = int(n)
    except (TypeError, ValueError):
        return False, "Movimiento inválido."

    movimientos = [m for m in caja.get("movimientos", []) if m.get("n") != n]
    if len(movimientos) == len(caja.get("movimientos", [])):
        return False, "El movimiento no existe."
    for i, m in enumerate(movimientos, start=1):
        m["n"] = i
    caja["movimientos"] = movimientos
    _recalcular_totales(caja)
    save_cajas(cajas)
    return True, "Movimiento eliminado correctamente."


def cerrar_caja(numero, monto_contado, observacion="", cerrado_por=""):
    cajas = load_cajas()
    caja = cajas.get(numero)
    if not caja:
        return False, "La caja no existe."
    if caja.get("estado") != "Abierta":
        return False, "La caja ya está cerrada."
    try:
        monto_contado = round(float(monto_contado), 2)
    except (TypeError, ValueError):
        return False, "Monto contado inválido."
    if monto_contado < 0:
        return False, "El monto contado no puede ser negativo."

    _recalcular_totales(caja)
    caja["monto_contado"] = monto_contado
    caja["diferencia"] = round(monto_contado - float(caja.get("total_esperado", 0)), 2)
    caja["estado"] = "Cerrada"
    caja["cierre"] = ahora().strftime("%Y-%m-%d %H:%M")
    caja["cerrado_por"] = cerrado_por or ""
    caja["observacion_cierre"] = observacion or ""
    save_cajas(cajas)
    return True, "Caja cerrada correctamente."


def reabrir_caja(numero):
    cajas = load_cajas()
    caja = cajas.get(numero)
    if not caja:
        return False, "La caja no existe."
    if caja.get("estado") != "Cerrada":
        return False, "La caja ya está abierta."
    caja["estado"] = "Abierta"
    caja["cierre"] = None
    caja["cerrado_por"] = ""
    caja["monto_contado"] = None
    caja["diferencia"] = 0.0
    caja["observacion_cierre"] = ""
    _recalcular_totales(caja)
    save_cajas(cajas)
    return True, "Caja reabierta correctamente."


def eliminar_caja(numero):
    cajas = load_cajas()
    if numero not in cajas:
        return False, "La caja no existe."
    del cajas[numero]
    save_cajas(cajas)
    return True, "Caja eliminada correctamente."
