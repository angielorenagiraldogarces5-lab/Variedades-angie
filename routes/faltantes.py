import json
import os
import re

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes.reposicion import _preparar_items
from utils import numero_whatsapp

bp = Blueprint("faltantes", __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CONFIG_FILE = os.path.join(DATA_DIR, "faltantes_config.json")


def _logueado():
    return session.get("logged_in")


def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {"numeros": ""}
    with open(CONFIG_FILE, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def save_config(config):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=4)


def _parse_numeros(numeros_str):
    numeros = []
    for parte in re.split(r"[,;\s]+", numeros_str or ""):
        parte = parte.strip()
        if parte:
            numeros.append(parte)
    return numeros


def _destinos():
    config = load_config()
    destinos = []
    for numero in _parse_numeros(config.get("numeros", "")):
        destinos.append({"raw": numero, "wa": numero_whatsapp(numero)})
    return destinos


def _armar_mensaje(items):
    lineas = ["Hola, te comparto la lista de productos que están faltando o por acabarse en el local:"]
    for it in items:
        nombre = it["p"].get("nombre", "")
        if it["sugerida"] > 0:
            lineas.append(f"- {nombre}: {it['sugerida']:g} unidades")
        else:
            lineas.append(f"- {nombre}")
    lineas.append("")
    lineas.append("Espero que lo tengas presente para reponer. ¡Gracias!")
    return "\n".join(lineas)


@bp.route("/faltantes")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))

    items = _preparar_items()
    agotados = sum(1 for it in items if it["agotado"])

    return render_template(
        "faltantes.html",
        items=items,
        agotados=agotados,
        stock_bajo_count=len(items) - agotados,
        destinos=_destinos(),
        config=load_config(),
        mensaje_whatsapp=_armar_mensaje(items),
    )


@bp.route("/faltantes/config", methods=["POST"])
def guardar_config():
    if not _logueado():
        return redirect(url_for("login.login"))

    numeros = request.form.get("numeros", "").strip()
    config = load_config()
    config["numeros"] = numeros
    save_config(config)
    flash("Números de WhatsApp actualizados correctamente.", "success")
    return redirect(url_for("faltantes.listar"))
