import json
import os
import re

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "productos.json")


def load_productos():
    if not os.path.exists(DATA_FILE):
        return {}
    with open(DATA_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def save_productos(productos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(productos, f, ensure_ascii=False, indent=4)


def _next_id(productos):
    ids = [int(k) for k in productos.keys()]
    return str(max(ids) + 1) if ids else "1"


def _normalizar(texto):
    texto = re.sub(r"\s*\(\d+[.,]\d{2}\)\s*$", "", str(texto))
    return texto.strip().lower()


def buscar_pid_por_nombre(nombre):
    productos = load_productos()
    buscado = _normalizar(nombre)
    for pid, p in productos.items():
        if _normalizar(p.get("nombre", "")) == buscado:
            return str(pid)
    return None


def _normalizar_codigo(codigo):
    if codigo is None:
        return None
    codigo = str(codigo).strip()
    return codigo or None


def crear_producto(
    nombre,
    categoria,
    precio,
    stock=0,
    stock_minimo=0,
    control_stock=True,
    costo=0,
    codigo=None,
):
    productos = load_productos()
    pid = _next_id(productos)
    codigo = _normalizar_codigo(codigo)
    if codigo is not None and any(
        _normalizar_codigo(p.get("codigo")) == codigo for p in productos.values()
    ):
        return False, "Ya existe un producto con ese código de barras."
    productos[pid] = {
        "nombre": nombre,
        "categoria": categoria,
        "codigo": codigo,
        "precio": round(float(precio), 2),
        "costo": round(float(costo or 0), 2),
        "stock": round(float(stock or 0), 2),
        "stock_fisico": None,
        "stock_minimo": round(float(stock_minimo or 0), 2),
        "control_stock": bool(control_stock),
    }
    save_productos(productos)
    return True, pid


def actualizar_producto(
    pid,
    nombre,
    categoria,
    precio,
    stock,
    stock_minimo,
    control_stock,
    costo=0,
    codigo=None,
):
    productos = load_productos()
    if str(pid) not in productos:
        return False, "El producto no existe."
    codigo = _normalizar_codigo(codigo)
    for otros_pid, p in productos.items():
        if str(otros_pid) == str(pid):
            continue
        if codigo is not None and _normalizar_codigo(p.get("codigo")) == codigo:
            return False, "Ya existe un producto con ese código de barras."
    productos[str(pid)] = {
        "nombre": nombre,
        "categoria": categoria,
        "codigo": codigo,
        "precio": round(float(precio), 2),
        "costo": round(float(costo or 0), 2),
        "stock": round(float(stock or 0), 2),
        "stock_fisico": productos[str(pid)].get("stock_fisico"),
        "stock_minimo": round(float(stock_minimo or 0), 2),
        "control_stock": bool(control_stock),
    }
    save_productos(productos)
    return True, "Producto actualizado correctamente."


def buscar_por_codigo(codigo):
    """Busca un producto por su código de barras."""
    productos = load_productos()
    codigo = _normalizar_codigo(codigo)
    if codigo is None:
        return None, None
    for pid, p in productos.items():
        if _normalizar_codigo(p.get("codigo")) == codigo:
            return str(pid), p
    return None, None


def guardar_stock_fisico(pid, stock_fisico):
    """Guarda la mercancía física contada de un producto sin tocar el stock del sistema."""
    productos = load_productos()
    if str(pid) not in productos:
        return False, "El producto no existe."
    try:
        stock_fisico = float(stock_fisico)
    except (TypeError, ValueError):
        return False, "El stock físico debe ser un número válido."
    if stock_fisico < 0:
        return False, "El stock físico no puede ser negativo."
    productos[str(pid)]["stock_fisico"] = round(stock_fisico, 2)
    save_productos(productos)
    return True, "Stock físico actualizado."


def eliminar_producto(pid):
    productos = load_productos()
    if str(pid) not in productos:
        return False, "El producto no existe."
    del productos[str(pid)]
    save_productos(productos)
    return True, "Producto eliminado correctamente."


def agrupar_por_categoria():
    """Agrupa los productos por categoría y devuelve una lista ordenada
    de tuplas (categoria, productos) con su valor total."""
    productos = load_productos()
    grupos = {}
    for pid, p in productos.items():
        cat = (p.get("categoria") or "").strip() or "Sin categoría"
        grupos.setdefault(cat, []).append((str(pid), p))
    return sorted(
        grupos.items(),
        key=lambda kv: kv[0].lower(),
    )
