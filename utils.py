from datetime import datetime
from zoneinfo import ZoneInfo

ZONA_ARG = ZoneInfo("America/Argentina/Buenos_Aires")


def ahora():
    """Fecha y hora actual en la zona horaria de Argentina (UTC-3)."""
    return datetime.now(ZONA_ARG)


def hoy():
    """Fecha actual (solo fecha) en la zona horaria de Argentina."""
    return ahora().date()


def numero_whatsapp(telefono, codigo_pais="54"):
    """Limpia un teléfono y le antepone el código de país para WhatsApp.

    Ej: "+54 9 2612 48-0399" -> "5492612480399"
    """
    if not telefono:
        return None
    digitos = "".join(ch for ch in str(telefono) if ch.isdigit())
    if not digitos:
        return None
    digitos = digitos.lstrip("0")
    if not digitos.startswith(codigo_pais):
        digitos = f"{codigo_pais}{digitos}"
    return digitos


def formatear_telefono(telefono):
    """Formatea un teléfono con el formato "+54 9 2612 48-0399".

    Acepta el número con o sin código de país y elimina comas.
    """
    if not telefono:
        return ""
    digitos = "".join(ch for ch in str(telefono) if ch.isdigit())
    if not digitos:
        return str(telefono)
    digitos = digitos.lstrip("0")
    if digitos.startswith("54"):
        digitos = digitos[2:]
    salida = "+54"
    if digitos.startswith("9"):
        salida += " 9"
        digitos = digitos[1:]
    if digitos:
        if len(digitos) >= 4:
            salida += " " + digitos[:4]
            digitos = digitos[4:]
        else:
            salida += " " + digitos
            return salida
    if digitos:
        if len(digitos) >= 6:
            salida += " " + digitos[:2] + "-" + digitos[2:6]
            digitos = digitos[6:]
        else:
            salida += " " + digitos
            return salida
    if digitos:
        salida += " " + digitos
    return salida


def formatear_moneda(valor):
    """Formatea un valor numérico como moneda con separador de miles (.) y decimales (,).

    Ej: 1234567.891 -> "$ 1.234.567,89"
    """
    try:
        monto = round(float(valor), 2)
    except (TypeError, ValueError):
        monto = 0.0

    entero, decimal = f"{monto:.2f}".split(".")
    signo = ""
    if entero.startswith("-"):
        signo = "-"
        entero = entero[1:]

    entero = "{:,}".format(int(entero)).replace(",", ".")
    return f"{signo}$ {entero},{decimal}"
