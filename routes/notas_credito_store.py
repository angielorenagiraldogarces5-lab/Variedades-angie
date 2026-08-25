import json
import os

from routes import facturas_store

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "notas_credito.json")

PREFIJO = "NC"
ESTADOS = ("Pendiente", "Aplicada")


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_notas():
    return _leer_json(DATA_FILE, {})


def save_notas(notas):
    _guardar_json(DATA_FILE, notas)


def generar_numero():
    n = facturas_store._siguiente_correlativo("NotaCredito")
    return f"{PREFIJO}-{n:04d}"


def cantidad_devuelta_por_item(factura_numero):
    devuelto = {}
    for nota in load_notas().values():
        if nota.get("factura_origen") != factura_numero:
            continue
        for item in nota.get("items", []):
            desc = item.get("descripcion", "")
            devuelto[desc] = round(
                devuelto.get(desc, 0) + float(item.get("cantidad", 0)), 2
            )
    return devuelto


def crear_nota(fecha, factura_origen, cliente, items, motivo, observacion, vendedor):
    numero = generar_numero()
    subtotal = round(
        sum(float(i.get("cantidad", 0)) * float(i.get("precio", 0)) for i in items), 2
    )
    nota = {
        "numero": numero,
        "fecha": fecha,
        "factura_origen": factura_origen,
        "cliente": cliente,
        "items": items,
        "subtotal": subtotal,
        "total": subtotal,
        "motivo": motivo or "Devolución de mercadería",
        "estado": "Pendiente",
        "observacion": observacion or "",
        "vendedor": vendedor or "",
    }
    notas = load_notas()
    notas[numero] = nota
    save_notas(notas)
    return numero


def actualizar_estado(numero, estado):
    notas = load_notas()
    if numero not in notas:
        return False, "La nota de crédito no existe."
    if estado not in ESTADOS:
        return False, "Estado no válido."
    notas[numero]["estado"] = estado
    save_notas(notas)
    return True, "Estado actualizado correctamente."


def eliminar_nota(numero):
    notas = load_notas()
    if numero not in notas:
        return False, "La nota de crédito no existe."
    del notas[numero]
    save_notas(notas)
    return True, "Nota de crédito eliminada correctamente."
