import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "proveedores.json")


def load_proveedores():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def save_proveedores(proveedores):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(proveedores, f, ensure_ascii=False, indent=4)


def _next_id(proveedores):
    ids = [int(k) for k in proveedores.keys()]
    return str(max(ids) + 1) if ids else "1"


def crear_proveedor(nombre, documento, telefono, correo, direccion):
    proveedores = load_proveedores()
    pid = _next_id(proveedores)
    proveedores[pid] = {
        "nombre": nombre,
        "documento": documento,
        "telefono": telefono,
        "correo": correo,
        "direccion": direccion,
    }
    save_proveedores(proveedores)
    return True, pid


def actualizar_proveedor(pid, nombre, documento, telefono, correo, direccion):
    proveedores = load_proveedores()
    if str(pid) not in proveedores:
        return False, "El proveedor no existe."
    proveedores[str(pid)] = {
        "nombre": nombre,
        "documento": documento,
        "telefono": telefono,
        "correo": correo,
        "direccion": direccion,
    }
    save_proveedores(proveedores)
    return True, "Proveedor actualizado correctamente."


def eliminar_proveedor(pid):
    proveedores = load_proveedores()
    if str(pid) not in proveedores:
        return False, "El proveedor no existe."
    del proveedores[str(pid)]
    save_proveedores(proveedores)
    return True, "Proveedor eliminado correctamente."
