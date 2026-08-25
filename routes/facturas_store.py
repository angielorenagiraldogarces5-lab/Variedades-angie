import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "facturas.json")
CORRELATIVO_FILE = os.path.join(DATA_DIR, "correlativo.json")

TIPOS = ("Factura", "Boleta")
FORMAS_PAGO = ("Efectivo", "Crédito", "Fiado")
PREFIJO = {"Factura": "F", "Boleta": "B"}


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_facturas():
    return _leer_json(DATA_FILE, {})


def save_facturas(facturas):
    _guardar_json(DATA_FILE, facturas)


def _load_correlativo():
    return _leer_json(CORRELATIVO_FILE, {"Factura": 0, "Boleta": 0})


def _siguiente_correlativo(tipo):
    corr = _load_correlativo()
    corr[tipo] = int(corr.get(tipo, 0)) + 1
    _guardar_json(CORRELATIVO_FILE, corr)
    return corr[tipo]


def generar_numero(tipo):
    n = _siguiente_correlativo(tipo)
    return f"{PREFIJO.get(tipo, 'F')}-{n:04d}"


def crear_factura(
    tipo,
    fecha,
    cliente,
    items,
    estado,
    observacion,
    vendedor,
    forma_pago="Efectivo",
    vendedor_username="",
    comision_pct=0.0,
):
    numero = generar_numero(tipo)
    subtotal = round(
        sum(float(i.get("cantidad", 0)) * float(i.get("precio", 0)) for i in items), 2
    )
    if forma_pago not in FORMAS_PAGO:
        forma_pago = "Efectivo"
    try:
        comision_pct = round(float(comision_pct or 0), 2)
    except (TypeError, ValueError):
        comision_pct = 0.0
    if comision_pct < 0:
        comision_pct = 0.0
    comision_monto = round(subtotal * comision_pct / 100.0, 2)
    factura = {
        "numero": numero,
        "tipo": tipo,
        "fecha": fecha,
        "cliente": cliente,
        "items": items,
        "subtotal": subtotal,
        "total": subtotal,
        "forma_pago": forma_pago,
        "estado": estado,
        "observacion": observacion or "",
        "vendedor": vendedor or "",
        "vendedor_username": vendedor_username or "",
        "comision_pct": comision_pct,
        "comision_monto": comision_monto,
    }
    facturas = load_facturas()
    facturas[numero] = factura
    save_facturas(facturas)
    return numero


def actualizar_estado(numero, estado):
    facturas = load_facturas()
    if numero not in facturas:
        return False, "La factura no existe."
    facturas[numero]["estado"] = estado
    save_facturas(facturas)
    return True, "Estado actualizado correctamente."


def eliminar_factura(numero):
    facturas = load_facturas()
    if numero not in facturas:
        return False, "La factura no existe."
    del facturas[numero]
    save_facturas(facturas)
    return True, "Factura eliminada correctamente."
