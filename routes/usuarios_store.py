import json
import os

from werkzeug.security import check_password_hash, generate_password_hash

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "usuarios.json")

DEFAULT_USERS = {
    "admin": {
        "password": generate_password_hash("1234"),
        "nombre": "Administrador Principal",
        "rol": "Admin",
        "comision": 0.0,
    },
    "trabajador": {
        "password": generate_password_hash("1234"),
        "nombre": "Trabajador de Turno",
        "rol": "Trabajador",
        "comision": 5.0,
    },
}


def _normalizar_comision(comision):
    try:
        c = round(float(comision), 2)
    except (TypeError, ValueError):
        c = 0.0
    if c < 0:
        c = 0.0
    return c


def load_usuarios():
    if not os.path.exists(DATA_FILE):
        save_usuarios(DEFAULT_USERS)
        return json.loads(json.dumps(DEFAULT_USERS))
    with open(DATA_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def save_usuarios(usuarios):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(usuarios, f, ensure_ascii=False, indent=4)


def verificar_usuario(username, password):
    usuarios = load_usuarios()
    usuario = usuarios.get(username)
    if usuario and check_password_hash(usuario.get("password", ""), password):
        return usuario
    return None


def crear_usuario(username, password, nombre, rol, comision=0.0):
    usuarios = load_usuarios()
    if username in usuarios:
        return False, "El nombre de usuario ya existe."
    usuarios[username] = {
        "password": generate_password_hash(password),
        "nombre": nombre,
        "rol": rol,
        "comision": _normalizar_comision(comision),
    }
    save_usuarios(usuarios)
    return True, f"Usuario '{username}' creado correctamente."


def actualizar_usuario(username, password=None, nombre=None, rol=None, comision=None):
    usuarios = load_usuarios()
    if username not in usuarios:
        return False, "El usuario no existe."
    if password:
        usuarios[username]["password"] = generate_password_hash(password)
    if nombre:
        usuarios[username]["nombre"] = nombre
    if rol:
        usuarios[username]["rol"] = rol
    if comision is not None:
        usuarios[username]["comision"] = _normalizar_comision(comision)
    save_usuarios(usuarios)
    return True, f"Usuario '{username}' actualizado correctamente."


def eliminar_usuario(username):
    usuarios = load_usuarios()
    if username not in usuarios:
        return False, "El usuario no existe."
    admins = [u for u, v in usuarios.items() if v["rol"] == "Admin"]
    if usuarios[username]["rol"] == "Admin" and len(admins) == 1:
        return False, "No se puede eliminar al último administrador del sistema."
    del usuarios[username]
    save_usuarios(usuarios)
    return True, f"Usuario '{username}' eliminado correctamente."
