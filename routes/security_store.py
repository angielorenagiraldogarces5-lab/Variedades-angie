import json
import os
import re
from datetime import timedelta

from utils import ahora

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
INTENTOS_FILE = os.path.join(DATA_DIR, "intentos.json")
AUDITORIA_FILE = os.path.join(DATA_DIR, "auditoria.json")

MAX_INTENTOS = 5
VENTANA_MINUTOS = 15
BLOQUEO_MINUTOS = 15


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


# ---------------------------------------------------------------
# Bloqueo por intentos fallidos de login
# ---------------------------------------------------------------
def _load_intentos():
    return _leer_json(INTENTOS_FILE, {})


def _bloqueo_actual(username):
    intentos = _load_intentos()
    reg = intentos.get(username.lower())
    if not reg or not reg.get("bloqueado_ts"):
        return False, 0
    try:
        hasta = int(reg.get("bloqueado_ts", 0))
    except (TypeError, ValueError):
        return False, 0
    if hasta <= 0:
        return False, 0
    faltan = hasta - int(ahora().timestamp())
    if faltan <= 0:
        intentos.pop(username.lower(), None)
        _guardar_json(INTENTOS_FILE, intentos)
        return False, 0
    return True, max(1, (faltan // 60) + 1)


def registrar_intento_fallido(username, ip=""):
    """Registra un intento fallido y devuelve (bloqueado, minutos_restantes)."""
    clave = (username or "").lower()
    intentos = _load_intentos()
    ahora_ts = int(ahora().timestamp())
    reg = intentos.get(clave, {"cuenta": 0, "ventana_desde": 0})

    ventana = reg.get("ventana_desde", 0)
    if ahora_ts - ventana > VENTANA_MINUTOS * 60:
        reg = {"cuenta": 0, "ventana_desde": ahora_ts}
    reg["cuenta"] = reg.get("cuenta", 0) + 1
    if reg["cuenta"] == 1:
        reg["ventana_desde"] = ahora_ts
    reg["ip"] = ip or ""

    if reg["cuenta"] >= MAX_INTENTOS:
        reg["bloqueado_ts"] = ahora_ts + BLOQUEO_MINUTOS * 60
        reg["cuenta"] = 0
        reg["ventana_desde"] = ahora_ts

    intentos[clave] = reg
    _guardar_json(INTENTOS_FILE, intentos)
    return _bloqueo_actual(clave)


def esta_bloqueado(username):
    return _bloqueo_actual(username)


def limpiar_intentos(username):
    intentos = _load_intentos()
    intentos.pop((username or "").lower(), None)
    _guardar_json(INTENTOS_FILE, intentos)


def listar_bloqueados():
    """Devuelve las cuentas actualmente bloqueadas con los minutos restantes."""
    intentos = _load_intentos()
    bloqueados = []
    for clave in intentos:
        bloqueado, minutos = _bloqueo_actual(clave)
        if bloqueado:
            bloqueados.append({"usuario": clave, "minutos": minutos})
    bloqueados.sort(key=lambda b: b["usuario"].lower())
    return bloqueados


def desbloquear_usuario(username):
    """Quita el bloqueo de una cuenta. Devuelve True si estaba bloqueada."""
    clave = (username or "").lower()
    if not clave:
        return False
    intentos = _load_intentos()
    if clave not in intentos:
        return False
    del intentos[clave]
    _guardar_json(INTENTOS_FILE, intentos)
    return True


# ---------------------------------------------------------------
# Auditoría de eventos de seguridad
# ---------------------------------------------------------------
def _load_auditoria():
    return _leer_json(AUDITORIA_FILE, [])


def registrar_evento(tipo, username, detalle="", ip=""):
    eventos = _load_auditoria()
    eventos.append(
        {
            "fecha": ahora().isoformat(timespec="seconds"),
            "tipo": tipo,
            "usuario": username or "",
            "detalle": detalle,
            "ip": ip or "",
        }
    )
    _guardar_json(AUDITORIA_FILE, eventos)


def load_auditoria():
    return _load_auditoria()


# ---------------------------------------------------------------
# Política de contraseñas
# ---------------------------------------------------------------
def validar_password(password):
    """Valida que la contraseña cumpla la política. Devuelve (ok, mensaje)."""
    if not password or len(password) < 8:
        return False, "La contraseña debe tener al menos 8 caracteres."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        return False, "La contraseña debe incluir al menos una letra y un número."
    return True, ""
