from datetime import date

from flask import Blueprint, redirect, render_template, request, session, url_for

from routes import fiados_store
from utils import numero_whatsapp

bp = Blueprint("recordatorios", __name__)


def _logueado():
    return session.get("logged_in")


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


def _generar_recordatorios(fiados):
    hoy = date.today()
    recordatorios = []
    for numero, f in fiados.items():
        if f.get("estado") == "Pagado":
            continue
        cliente = f.get("cliente", {})
        nombre = cliente.get("nombre", "Sin nombre")
        telefono = cliente.get("telefono", "")
        for c in f.get("cuotas", []):
            if c.get("estado") == "Pagada":
                continue
            fecha_limite = _parsear_fecha(c.get("fecha_limite"))
            if not fecha_limite:
                continue
            saldo = round(float(c.get("monto", 0)) - float(c.get("monto_abonado", 0)), 2)
            if saldo <= 0:
                continue
            dias = (hoy - fecha_limite).days

            if dias < -2:
                continue
            elif dias < 0:
                tipo = "proximo"
                mensaje = (
                    f"Hola {nombre}, te recordamos que tu cuota N°{c.get('n')} "
                    f"de ${saldo:,.0f} vence el {fecha_limite.strftime('%d/%m')}. "
                    f"¡Gracias por tu compra en Variedades Angie!"
                )
            elif dias == 0:
                tipo = "hoy"
                mensaje = (
                    f"Hola {nombre}, tu cuota N°{c.get('n')} de ${saldo:,.0f} "
                    f"vence hoy. ¡No te olvides de abonar! Variedades Angie."
                )
            elif dias <= 30:
                tipo = "vencida"
                mensaje = (
                    f"Hola {nombre}, tu cuota N°{c.get('n')} de ${saldo:,.0f} "
                    f"está vencida desde hace {dias} días. Por favor, acercate a abonar. "
                    f"Variedades Angie."
                )
            else:
                tipo = "moroso"
                mensaje = (
                    f"Hola {nombre}, tenemos registro de una deuda pendiente de "
                    f"${saldo:,.0f} desde hace {dias} días. Es importante que nos "
                    f"contactes para encontrar una solución. Variedades Angie."
                )

            recordatorios.append({
                "fiado": numero,
                "cuota": c.get("n"),
                "cliente": nombre,
                "telefono": telefono,
                "telefono_wa": numero_whatsapp(telefono) if telefono else None,
                "monto": saldo,
                "fecha_limite": c.get("fecha_limite"),
                "dias": dias,
                "tipo": tipo,
                "mensaje": mensaje,
            })

    recordatorios.sort(key=lambda r: (-r["dias"]))
    return recordatorios


@bp.route("/recordatorios")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    fiados = fiados_store.load_fiados()
    recordatorios = _generar_recordatorios(fiados)

    filtro = request.args.get("filtro", "todos")
    if filtro == "vencidas":
        recordatorios = [r for r in recordatorios if r["dias"] > 0]
    elif filtro == "proximas":
        recordatorios = [r for r in recordatorios if r["dias"] <= 0]
    elif filtro == "morosos":
        recordatorios = [r for r in recordatorios if r["dias"] > 30]

    return render_template(
        "recordatorios.html",
        recordatorios=recordatorios,
        filtro=filtro,
    )
