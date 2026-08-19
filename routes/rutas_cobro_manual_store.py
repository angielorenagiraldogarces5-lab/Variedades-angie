import json
import os
from datetime import date

from routes import facturas_store
from utils import formatear_moneda

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "rutas_cobro_manual.json")

PREFIJO = "RC"


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_rutas():
    return _leer_json(DATA_FILE, {})


def save_rutas(rutas):
    _guardar_json(DATA_FILE, rutas)


def generar_numero():
    n = facturas_store._siguiente_correlativo("RutaCobro")
    return f"{PREFIJO}-{n:04d}"


def crear_ruta(fecha, nombre, observaciones, creado_por):
    rutas = load_rutas()
    numero = generar_numero()
    ruta = {
        "numero": numero,
        "fecha": fecha,
        "nombre": nombre or f"Ruta {fecha}",
        "observaciones": observaciones or "",
        "visitantes": [],
        "total_esperado": 0.0,
        "total_cobrado": 0.0,
        "estado": "Pendiente",
        "creado_por": creado_por or "",
        "fecha_creacion": date.today().isoformat(),
    }
    rutas[numero] = ruta
    save_rutas(rutas)
    return numero


def agregar_visitante(numero_ruta, cliente_id, cliente_nombre, cliente_telefono,
                      cliente_direccion, monto, notas, fiado_vinculado=None, cobrador=None):
    rutas = load_rutas()
    ruta = rutas.get(numero_ruta)
    if not ruta:
        return False, "La ruta no existe."
    visitantes = ruta.setdefault("visitantes", [])
    orden = len(visitantes) + 1
    visitante = {
        "n": orden,
        "cliente_id": str(cliente_id) if cliente_id else "",
        "cliente_nombre": cliente_nombre,
        "cliente_telefono": cliente_telefono or "",
        "cliente_direccion": cliente_direccion or "",
        "monto": round(float(monto or 0), 2),
        "monto_cobrado": 0.0,
        "notas": notas or "",
        "estado": "Pendiente",
        "fiado_vinculado": fiado_vinculado,
        "cobrador": cobrador or "",
    }
    visitantes.append(visitante)
    ruta["total_esperado"] = round(sum(v["monto"] for v in visitantes), 2)
    save_rutas(rutas)
    return True, "Visitante agregado correctamente."


def eliminar_visitante(numero_ruta, n_visitante):
    rutas = load_rutas()
    ruta = rutas.get(numero_ruta)
    if not ruta:
        return False, "La ruta no existe."
    visitantes = ruta.get("visitantes", [])
    ruta["visitantes"] = [v for v in visitantes if v.get("n") != n_visitante]
    for i, v in enumerate(ruta["visitantes"], 1):
        v["n"] = i
    ruta["total_esperado"] = round(sum(v["monto"] for v in ruta["visitantes"]), 2)
    _recalcular_cobrado(ruta)
    save_rutas(rutas)
    return True, "Visitante eliminado."


def marcar_cobrado(numero_ruta, n_visitante, monto_cobrado):
    rutas = load_rutas()
    ruta = rutas.get(numero_ruta)
    if not ruta:
        return False, "La ruta no existe."
    visitante = None
    for v in ruta.get("visitantes", []):
        if v.get("n") == n_visitante:
            v["monto_cobrado"] = round(float(monto_cobrado or 0), 2)
            v["estado"] = "Cobrado" if v["monto_cobrado"] > 0 else "Pendiente"
            visitante = v
            break
    else:
        return False, "Visitante no encontrado."

    fiado_vinculado = visitante.get("fiado_vinculado")
    if fiado_vinculado and visitante.get("monto_cobrado", 0) > 0:
        from routes import fiados_store
        ok_f, msg_f = fiados_store.registrar_abono(
            fiado_vinculado,
            date.today().isoformat(),
            visitante["monto_cobrado"],
            "Ruta " + numero_ruta,
        )
        if not ok_f:
            return False, f"Cobro registrado pero error al abonar fiado: {msg_f}"

    _recalcular_cobrado(ruta)
    _actualizar_estado_ruta(ruta)
    save_rutas(rutas)
    return True, "Cobro registrado." + (" Abono vinculado al fiado." if fiado_vinculado else "")


def marcar_no_cobrado(numero_ruta, n_visitante, motivo=""):
    rutas = load_rutas()
    ruta = rutas.get(numero_ruta)
    if not ruta:
        return False, "La ruta no existe."
    for v in ruta.get("visitantes", []):
        if v.get("n") == n_visitante:
            v["monto_cobrado"] = 0.0
            v["estado"] = "No cobrado"
            v["notas"] = f"{v.get('notas', '')} | No cobrado: {motivo}".strip(" |")
            break
    else:
        return False, "Visitante no encontrado."
    _recalcular_cobrado(ruta)
    _actualizar_estado_ruta(ruta)
    save_rutas(rutas)
    return True, "Marcado como no cobrado."


def eliminar_ruta(numero):
    rutas = load_rutas()
    if numero not in rutas:
        return False, "La ruta no existe."
    del rutas[numero]
    save_rutas(rutas)
    return True, "Ruta eliminada correctamente."


def _recalcular_cobrado(ruta):
    ruta["total_cobrado"] = round(
        sum(float(v.get("monto_cobrado", 0)) for v in ruta.get("visitantes", [])), 2
    )


def _actualizar_estado_ruta(ruta):
    visitantes = ruta.get("visitantes", [])
    if not visitantes:
        ruta["estado"] = "Pendiente"
        return
    estados = [v.get("estado", "Pendiente") for v in visitantes]
    if all(e == "Cobrado" for e in estados):
        ruta["estado"] = "Completada"
    elif all(e in ("Cobrado", "No cobrado") for e in estados):
        ruta["estado"] = "Completada"
    elif any(e in ("Cobrado", "No cobrado") for e in estados):
        ruta["estado"] = "En curso"
    else:
        ruta["estado"] = "Pendiente"


def mover_visitante(numero_ruta, n_visitante, direccion):
    rutas = load_rutas()
    ruta = rutas.get(numero_ruta)
    if not ruta:
        return False, "La ruta no existe."
    visitantes = ruta.get("visitantes", [])
    idx = None
    for i, v in enumerate(visitantes):
        if v.get("n") == n_visitante:
            idx = i
            break
    if idx is None:
        return False, "Visitante no encontrado."
    nuevo_idx = idx - 1 if direccion == "arriba" else idx + 1
    if nuevo_idx < 0 or nuevo_idx >= len(visitantes):
        return False, "Ya está en esa posición."
    visitantes[idx], visitantes[nuevo_idx] = visitantes[nuevo_idx], visitantes[idx]
    for i, v in enumerate(visitantes, 1):
        v["n"] = i
    save_rutas(rutas)
    return True, "Visitante reordenado."


def editar_visitante(numero_ruta, n_visitante, cobrador=None):
    rutas = load_rutas()
    ruta = rutas.get(numero_ruta)
    if not ruta:
        return False, "La ruta no existe."
    for v in ruta.get("visitantes", []):
        if v.get("n") == n_visitante:
            if cobrador is not None:
                v["cobrador"] = cobrador
            save_rutas(rutas)
            return True, "Visitante actualizado."
    return False, "Visitante no encontrado."


def editar_ruta(numero, fecha=None, nombre=None, observaciones=None):
    rutas = load_rutas()
    ruta = rutas.get(numero)
    if not ruta:
        return False, "La ruta no existe."
    if fecha is not None:
        ruta["fecha"] = fecha
    if nombre is not None:
        ruta["nombre"] = nombre
    if observaciones is not None:
        ruta["observaciones"] = observaciones
    save_rutas(rutas)
    return True, "Ruta actualizada correctamente."


def obtener_ruta(numero):
    rutas = load_rutas()
    return rutas.get(numero)


def rutas_por_fecha(fecha_str):
    rutas = load_rutas()
    return {k: v for k, v in rutas.items() if v.get("fecha") == fecha_str}


def todas_las_rutas():
    return load_rutas()


def visitantes_para_calendario(anio, mes):
    """Devuelve visitas de rutas manuales para el mes dado, agrupadas por día."""
    from collections import defaultdict
    rutas = load_rutas()
    por_dia = defaultdict(list)
    for num_ruta, ruta in rutas.items():
        fecha = ruta.get("fecha", "")
        try:
            from datetime import date as _date
            f = _date.fromisoformat(fecha)
        except (TypeError, ValueError):
            continue
        if f.year != anio or f.month != mes:
            continue
        for v in ruta.get("visitantes", []):
            por_dia[f.day].append({
                "cliente": v.get("cliente_nombre", "Sin nombre"),
                "monto": v.get("monto", 0),
                "monto_cobrado": v.get("monto_cobrado", 0),
                "estado": v.get("estado", "Pendiente"),
                "cobrador": v.get("cobrador", ""),
                "fiado": v.get("fiado_vinculado", ""),
                "ruta_numero": num_ruta,
                "ruta_nombre": ruta.get("nombre", ""),
                "vencida": False,
                "hoy": f == _date.today(),
                "tipo": "ruta_manual",
            })
    return dict(por_dia)
