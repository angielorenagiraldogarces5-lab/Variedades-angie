import json
import os
from datetime import datetime

from routes import facturas_store

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DATA_FILE = os.path.join(DATA_DIR, "pagares.json")

PREFIJO = "PAG"
MONEDA = "PESOS ARGENTINOS"
ESTADOS = ("Vigente", "Pagado", "Cancelado")

MESES = (
    "",
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)

UNIDADES = ("", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve")
ESPECIALES = (
    "diez",
    "once",
    "doce",
    "trece",
    "catorce",
    "quince",
    "dieciséis",
    "diecisiete",
    "dieciocho",
    "diecinueve",
)
DECENAS = ("", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa")
CENTENAS = ("", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos")


def _leer_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def _guardar_json(path, datos):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=4)


def load_pagares():
    return _leer_json(DATA_FILE, {})


def save_pagares(pagares):
    _guardar_json(DATA_FILE, pagares)


def generar_numero():
    n = facturas_store._siguiente_correlativo("Pagare")
    return f"{PREFIJO}-{n:04d}"


def formatear_fecha(fecha_str):
    try:
        d = datetime.strptime(fecha_str, "%Y-%m-%d")
    except (TypeError, ValueError):
        return fecha_str or ""
    return f"{d.day} de {MESES[d.month]} de {d.year}"


def _tres_digitos(n):
    if n == 0:
        return ""
    c, resto = divmod(n, 100)
    if resto == 0:
        return "cien" if c == 1 else CENTENAS[c]
    d, u = divmod(resto, 10)
    partes = []
    if c:
        partes.append(CENTENAS[c])
    if d == 0:
        partes.append(UNIDADES[u])
    elif d == 1:
        partes.append(ESPECIALES[u])
    elif d == 2 and u:
        partes.append("veinti" + UNIDADES[u])
    else:
        if u:
            partes.append(DECENAS[d] + " y " + UNIDADES[u])
        else:
            partes.append(DECENAS[d])
    return " ".join(partes)


def _numero_a_palabras(n):
    if n == 0:
        return "cero"
    partes = []
    millones = n // 1000000
    miles = (n % 1000000) // 1000
    resto = n % 1000
    if millones:
        if millones == 1:
            partes.append("un millón")
        else:
            partes.append(_tres_digitos(millones) + " millones")
    if miles:
        if miles == 1:
            partes.append("mil")
        else:
            partes.append(_tres_digitos(miles) + " mil")
    if resto:
        partes.append(_tres_digitos(resto))
    return " ".join(partes)


def monto_en_letras(monto):
    try:
        monto = round(float(monto), 2)
    except (TypeError, ValueError):
        return ""
    entero = int(monto)
    centavos = int(round((monto - entero) * 100))
    texto = _numero_a_palabras(entero)
    if texto == "uno":
        texto = "un"
    elif texto.startswith("uno "):
        texto = "un" + texto[3:]
    pesos = "peso" if entero == 1 else "pesos"
    return f"{texto} {pesos} con {centavos:02d}/100"


def crear_pagare(
    fecha,
    lugar,
    cliente,
    acreedor,
    monto,
    interes,
    fecha_vencimiento,
    origen,
    observacion,
    vendedor,
):
    try:
        monto = round(float(monto), 2)
    except (TypeError, ValueError):
        monto = 0.0
    try:
        interes = round(float(interes), 2)
    except (TypeError, ValueError):
        interes = 0.0

    numero = generar_numero()
    pagare = {
        "numero": numero,
        "fecha": fecha,
        "lugar": lugar or "",
        "cliente": cliente,
        "acreedor": acreedor,
        "monto": monto,
        "monto_letras": monto_en_letras(monto).upper(),
        "interes": interes,
        "fecha_vencimiento": fecha_vencimiento or "",
        "origen": origen,
        "observacion": observacion or "",
        "estado": "Vigente",
        "vendedor": vendedor or "",
    }
    pagares = load_pagares()
    pagares[numero] = pagare
    save_pagares(pagares)
    return numero


def actualizar_estado(numero, estado):
    pagares = load_pagares()
    if numero not in pagares:
        return False, "El pagaré no existe."
    if estado not in ESTADOS:
        return False, "Estado no válido."
    pagares[numero]["estado"] = estado
    save_pagares(pagares)
    return True, "Estado actualizado correctamente."


def eliminar_pagare(numero):
    pagares = load_pagares()
    if numero not in pagares:
        return False, "El pagaré no existe."
    del pagares[numero]
    save_pagares(pagares)
    return True, "Pagaré eliminado correctamente."
