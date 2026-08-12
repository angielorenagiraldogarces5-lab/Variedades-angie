import json
import os

from routes import productos_store
from utils import ahora

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
MOV_FILE = os.path.join(DATA_DIR, "movimientos.json")
CONTEOS_FILE = os.path.join(DATA_DIR, "conteos.json")

TIPOS = ("Entrada", "Salida")


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_movimientos():
    return _leer_json(MOV_FILE, {})


def save_movimientos(movimientos):
    _guardar_json(MOV_FILE, movimientos)


def _next_id(movimientos):
    ids = [int(k) for k in movimientos.keys()]
    return str(max(ids) + 1) if ids else "1"


def _ajustar_stock(pid, delta):
    productos = productos_store.load_productos()
    if str(pid) not in productos:
        return False
    stock = float(productos[str(pid)].get("stock", 0))
    nuevo = round(stock + delta, 2)
    if nuevo < 0:
        return False
    productos[str(pid)]["stock"] = nuevo
    productos_store.save_productos(productos)
    return True


def registrar_movimiento(tipo, pid, cantidad, motivo, fecha, usuario, referencia=""):
    if tipo not in TIPOS:
        return False, "Tipo de movimiento no válido."
    productos = productos_store.load_productos()
    if str(pid) not in productos:
        return False, "El producto no existe."
    if not productos[str(pid)].get("control_stock", False):
        return False, "El producto no tiene control de stock."
    try:
        cantidad = float(cantidad)
    except (TypeError, ValueError):
        return False, "La cantidad debe ser un número válido."
    if cantidad <= 0:
        return False, "La cantidad debe ser mayor que cero."

    delta = cantidad if tipo == "Entrada" else -cantidad
    if not _ajustar_stock(pid, delta):
        return False, "No hay stock suficiente para realizar la salida."

    movimientos = load_movimientos()
    mid = _next_id(movimientos)
    movimientos[mid] = {
        "id": mid,
        "tipo": tipo,
        "pid": str(pid),
        "producto": productos[str(pid)]["nombre"],
        "cantidad": round(cantidad, 2),
        "motivo": motivo or "",
        "fecha": fecha or ahora().strftime("%Y-%m-%d"),
        "usuario": usuario or "",
        "referencia": referencia,
    }
    save_movimientos(movimientos)
    return True, mid


def registrar_entrada(pid, cantidad, motivo, fecha, usuario, referencia=""):
    return registrar_movimiento("Entrada", pid, cantidad, motivo, fecha, usuario, referencia)


def registrar_salida(pid, cantidad, motivo, fecha, usuario, referencia=""):
    return registrar_movimiento("Salida", pid, cantidad, motivo, fecha, usuario, referencia)


def eliminar_movimiento(mid):
    movimientos = load_movimientos()
    if str(mid) not in movimientos:
        return False, "El movimiento no existe."
    mov = movimientos[str(mid)]
    delta = (
        -float(mov["cantidad"])
        if mov["tipo"] == "Entrada"
        else float(mov["cantidad"])
    )
    if not _ajustar_stock(mov["pid"], delta):
        return False, "No se puede eliminar: dejaría el stock en negativo."
    del movimientos[str(mid)]
    save_movimientos(movimientos)
    return True, "Movimiento eliminado correctamente."


def stock_bajo():
    return [
        (pid, p)
        for pid, p in productos_store.load_productos().items()
        if p.get("control_stock", False)
        and float(p.get("stock", 0)) <= float(p.get("stock_minimo", 0))
    ]


def load_conteos():
    return _leer_json(CONTEOS_FILE, {})


def save_conteos(conteos):
    _guardar_json(CONTEOS_FILE, conteos)


def _next_conteo_id(conteos):
    ids = [int(k) for k in conteos.keys()]
    return str(max(ids) + 1) if ids else "1"


def registrar_conteo(pid, stock_real, motivo, fecha, usuario):
    """Registra un conteo físico y ajusta el stock del producto al valor real."""
    productos = productos_store.load_productos()
    if str(pid) not in productos:
        return False, "El producto no existe."
    if not productos[str(pid)].get("control_stock", False):
        return False, "El producto no tiene control de stock."
    try:
        stock_real = float(stock_real)
    except (TypeError, ValueError):
        return False, "El stock real debe ser un número válido."
    if stock_real < 0:
        return False, "El stock real no puede ser negativo."

    stock_sistema = round(float(productos[str(pid)].get("stock", 0) or 0), 2)
    diferencia = round(stock_real - stock_sistema, 2)
    if not _ajustar_stock(pid, diferencia):
        return False, "No se pudo aplicar el ajuste de stock."

    conteos = load_conteos()
    cid = _next_conteo_id(conteos)
    conteos[cid] = {
        "id": cid,
        "pid": str(pid),
        "producto": productos[str(pid)]["nombre"],
        "stock_sistema": stock_sistema,
        "stock_real": round(stock_real, 2),
        "diferencia": diferencia,
        "motivo": motivo or "",
        "fecha": fecha or ahora().strftime("%Y-%m-%d"),
        "usuario": usuario or "",
    }
    save_conteos(conteos)
    return True, cid


def eliminar_conteo(cid):
    conteos = load_conteos()
    if str(cid) not in conteos:
        return False, "El conteo no existe."
    conteo = conteos[str(cid)]
    if not _ajustar_stock(conteo["pid"], -float(conteo["diferencia"])):
        return False, "No se puede eliminar: dejaría el stock en negativo."
    del conteos[str(cid)]
    save_conteos(conteos)
    return True, "Conteo eliminado correctamente."


def resumen_inventario():
    """Estadísticas para el panel de inventario: valor, categorías y movimientos."""
    productos = productos_store.load_productos()
    movimientos = load_movimientos()
    mes = ahora().strftime("%Y-%m")

    valor_total = 0.0
    agotados = 0
    bajo = 0
    con_control = 0
    categorias = {}

    for p in productos.values():
        stock = float(p.get("stock", 0) or 0)
        costo = float(p.get("costo", 0) or 0)
        valor = round(stock * costo, 2)
        valor_total += valor
        cat = (p.get("categoria") or "").strip() or "Sin categoría"
        c = categorias.setdefault(cat, {"cantidad": 0, "valor": 0.0})
        c["cantidad"] += 1
        c["valor"] = round(c["valor"] + valor, 2)
        if p.get("control_stock", False):
            con_control += 1
            if stock <= 0:
                agotados += 1
            elif stock <= float(p.get("stock_minimo", 0) or 0):
                bajo += 1

    entradas_mes = 0.0
    salidas_mes = 0.0
    mov_mes = 0
    for m in movimientos.values():
        if str(m.get("fecha", ""))[:7] == mes:
            mov_mes += 1
            cantidad = float(m.get("cantidad", 0) or 0)
            if m.get("tipo") == "Entrada":
                entradas_mes += cantidad
            else:
                salidas_mes += cantidad

    return {
        "productos_total": len(productos),
        "con_control": con_control,
        "agotados": agotados,
        "stock_bajo": bajo,
        "valor_total": round(valor_total, 2),
        "categorias": dict(
            sorted(categorias.items(), key=lambda kv: kv[1]["valor"], reverse=True)
        ),
        "movimientos_mes": mov_mes,
        "entradas_mes": round(entradas_mes, 2),
        "salidas_mes": round(salidas_mes, 2),
    }
