import json
import os

from routes import caja_store, facturas_store, inventario_store

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "compras.json")

PREFIJO = "C"
ESTADOS = ("Pendiente", "Pagada")
CONCEPTO_PAGO = "Pago a proveedor"


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_compras():
    return _leer_json(DATA_FILE, {})


def save_compras(compras):
    _guardar_json(DATA_FILE, compras)


def generar_numero():
    n = facturas_store._siguiente_correlativo("Compra")
    return f"{PREFIJO}-{n:04d}"


def crear_compra(fecha, proveedor, items, estado, observacion, usuario):
    numero = generar_numero()
    subtotal = round(
        sum(float(i.get("cantidad", 0)) * float(i.get("costo", 0)) for i in items), 2
    )
    compra = {
        "numero": numero,
        "fecha": fecha,
        "proveedor": proveedor,
        "items": items,
        "subtotal": subtotal,
        "total": subtotal,
        "estado": estado,
        "observacion": observacion or "",
        "registrado_por": usuario or "",
        "caja_movimiento": None,
    }
    compras = load_compras()
    compras[numero] = compra
    save_compras(compras)
    return True, numero


def _concepto_pago(compra):
    """Concepto detallado del egreso: compra + proveedor + observación."""
    proveedor = compra.get("proveedor", {}).get("nombre", "")
    concepto = f"{CONCEPTO_PAGO}: {compra.get('numero')}"
    if proveedor:
        concepto += f" · {proveedor}"
    observacion = (compra.get("observacion") or "").strip()
    if observacion:
        concepto += f" · {observacion}"
    return concepto


def _registrar_pago(numero, usuario):
    """Registra el egreso 'Pago a proveedor' en la caja abierta."""
    compras = load_compras()
    compra = compras.get(numero)
    if not compra:
        return False, "La compra no existe.", None
    caja = caja_store.caja_abierta()
    if not caja:
        return False, "No hay una caja abierta para registrar el pago.", None
    ok, msg = caja_store.registrar_movimiento(
        caja["numero"], "Egreso", _concepto_pago(compra), compra.get("total", 0), usuario
    )
    if not ok:
        return False, msg, None
    caja_actualizada = caja_store.load_cajas().get(caja["numero"])
    movimientos = caja_actualizada.get("movimientos", []) if caja_actualizada else []
    n = movimientos[-1]["n"] if movimientos else None
    return True, msg, {"numero": caja["numero"], "n": n}


def revertir_a_pendiente(numero):
    compras = load_compras()
    compra = compras.get(numero)
    if not compra or compra.get("estado") != "Pagada":
        return
    compra["estado"] = "Pendiente"
    compra["caja_movimiento"] = None
    save_compras(compras)


def registrar_pago_compra(numero, usuario):
    compras = load_compras()
    compra = compras.get(numero)
    if not compra:
        return False, "La compra no existe."
    if compra.get("caja_movimiento"):
        return True, "El pago de esta compra ya fue registrado en caja."
    ok, msg, ref = _registrar_pago(numero, usuario)
    if not ok:
        return False, msg
    compra["caja_movimiento"] = ref
    save_compras(compras)
    return True, "Egreso registrado en caja correctamente."


def _revertir_pago(compra):
    ref = compra.get("caja_movimiento")
    if not ref:
        return True, ""
    ok, msg = caja_store.eliminar_movimiento(ref.get("numero"), ref.get("n"))
    if not ok:
        return False, msg
    return True, ""


def _caja_movimiento_revertible(compra):
    ref = compra.get("caja_movimiento")
    if not ref:
        return True
    caja = caja_store.load_cajas().get(ref.get("numero"))
    return bool(caja) and caja.get("estado") == "Abierta"


def actualizar_estado(numero, nuevo_estado, usuario):
    compras = load_compras()
    if numero not in compras:
        return False, "La compra no existe."
    if nuevo_estado not in ESTADOS:
        return False, "Estado no válido."
    compra = compras[numero]
    if compra.get("estado") == nuevo_estado:
        return True, "El estado de la compra no cambió."

    if nuevo_estado == "Pagada":
        ok, msg = registrar_pago_compra(numero, usuario)
        if not ok:
            return False, f"No se pudo registrar el pago en caja: {msg}"
        compras = load_compras()
        compra = compras[numero]
        compra["estado"] = nuevo_estado
        save_compras(compras)
        return True, "Compra marcada como pagada. " + msg
    else:
        if compra.get("caja_movimiento"):
            if not _caja_movimiento_revertible(compra):
                return False, (
                    "No se pudo revertir el pago: la caja está cerrada. "
                    "Reabre la caja para eliminar el egreso."
                )
            ok, msg = _revertir_pago(compra)
            if not ok:
                return False, f"No se pudo revertir el pago en caja: {msg}"
            compra["caja_movimiento"] = None
        compra["estado"] = nuevo_estado
        save_compras(compras)
        return True, "Compra marcada como pendiente."


def eliminar_compra(numero):
    compras = load_compras()
    if numero not in compras:
        return False, "La compra no existe."
    compra = compras[numero]

    if compra.get("caja_movimiento") and not _caja_movimiento_revertible(compra):
        return False, (
            "No se puede eliminar: la caja está cerrada y el pago de esta "
            "compra ya fue registrado. Reabre la caja para revertir el egreso."
        )

    for item in compra.get("items", []):
        mid = item.get("mov_id")
        if not mid:
            continue
        ok, msg = inventario_store.eliminar_movimiento(mid)
        if not ok:
            return False, f"No se puede eliminar la compra: {msg}"

    if compra.get("caja_movimiento"):
        ok, msg = _revertir_pago(compra)
        if not ok:
            return False, f"No se pudo revertir el pago en caja: {msg}"

    del compras[numero]
    save_compras(compras)
    return True, "Compra eliminada correctamente."
