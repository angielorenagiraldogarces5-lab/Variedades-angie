from datetime import date, timedelta

from flask import Blueprint, redirect, render_template, request, session, url_for

from routes import fiados_store
from utils import ahora, numero_whatsapp

bp = Blueprint("ruta_cobro", __name__)


def _logueado():
    return session.get("logged_in")


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


def _ruta_para_fecha(fiados, fecha_obj):
    ruta = []
    for numero, f in fiados.items():
        if f.get("estado") == "Pagado":
            continue
        cliente = f.get("cliente", {})
        saldo_fiado = round(float(f.get("saldo_pendiente", 0)), 2)
        if saldo_fiado <= 0:
            continue
        for fr in f.get("fechas_ruta", []):
            if fr.get("cobrado"):
                continue
            fecha = _parsear_fecha(fr.get("fecha"))
            if not fecha or fecha != fecha_obj:
                continue
            ruta.append({
                "fiado": numero,
                "cliente": cliente.get("nombre", "Sin nombre"),
                "telefono": cliente.get("telefono", ""),
                "telefono_wa": numero_whatsapp(cliente.get("telefono", "")) if cliente.get("telefono") else None,
                "direccion": cliente.get("direccion", ""),
                "monto": saldo_fiado,
                "frecuencia": f.get("frecuencia", ""),
                "vencida": fecha < date.today(),
            })
    return sorted(ruta, key=lambda r: r["cliente"])


@bp.route("/ruta-cobro")
def diaria():
    if not _logueado():
        return redirect(url_for("login.login"))

    hoy = date.today()
    fecha_param = request.args.get("fecha", "").strip()
    fecha = _parsear_fecha(fecha_param) or hoy

    fiados = fiados_store.load_fiados()
    ruta = _ruta_para_fecha(fiados, fecha)
    total_ruta = round(sum(r["monto"] for r in ruta), 2)

    dias_semana = {
        0: "Lunes", 1: "Martes", 2: "Miércoles", 3: "Jueves",
        4: "Viernes", 5: "Sábado", 6: "Domingo",
    }
    nombre_dia = dias_semana.get(fecha.weekday(), "")

    return render_template(
        "ruta_cobro.html",
        ruta=ruta,
        fecha=fecha,
        fecha_hoy=hoy,
        nombre_dia=nombre_dia,
        total_ruta=total_ruta,
        total_clientes=len(ruta),
        fecha_anterior=(fecha - timedelta(days=1)).isoformat(),
        fecha_siguiente=(fecha + timedelta(days=1)).isoformat(),
    )
