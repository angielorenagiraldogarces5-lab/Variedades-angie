import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "clientes.json")


def load_clientes():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def save_clientes(clientes):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(clientes, f, ensure_ascii=False, indent=4)


def _next_id(clientes):
    ids = [int(k) for k in clientes.keys()]
    return str(max(ids) + 1) if ids else "1"


def crear_cliente(nombre, documento, telefono, direccion, limite_credito=0):
    clientes = load_clientes()
    cid = _next_id(clientes)
    clientes[cid] = {
        "nombre": nombre,
        "documento": documento,
        "telefono": telefono,
        "direccion": direccion,
        "limite_credito": float(limite_credito),
        "credito_usado": 0.0,
        "moroso": False,
        "score_historial": 50,
        "total_fiados": 0,
        "fiados_pagados": 0,
        "fiados_con_mora": 0,
    }
    save_clientes(clientes)
    return True, cid


def buscar_cliente(cid):
    clientes = load_clientes()
    return clientes.get(str(cid))


def actualizar_cliente(cid, nombre, documento, telefono, direccion, limite_credito=None):
    clientes = load_clientes()
    if str(cid) not in clientes:
        return False, "El cliente no existe."
    existente = clientes[str(cid)]
    clientes[str(cid)] = {
        "nombre": nombre,
        "documento": documento,
        "telefono": telefono,
        "direccion": direccion,
        "limite_credito": float(limite_credito) if limite_credito is not None else existente.get("limite_credito", 0),
        "credito_usado": existente.get("credito_usado", 0.0),
        "moroso": existente.get("moroso", False),
        "score_historial": existente.get("score_historial", 50),
        "total_fiados": existente.get("total_fiados", 0),
        "fiados_pagados": existente.get("fiados_pagados", 0),
        "fiados_con_mora": existente.get("fiados_con_mora", 0),
    }
    save_clientes(clientes)
    return True, "Cliente actualizado correctamente."


def eliminar_cliente(cid):
    clientes = load_clientes()
    if str(cid) not in clientes:
        return False, "El cliente no existe."
    del clientes[str(cid)]
    save_clientes(clientes)
    return True, "Cliente eliminado correctamente."
