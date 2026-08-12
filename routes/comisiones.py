from flask import Blueprint, redirect, render_template, request, session, url_for

from routes import facturas_store, usuarios_store

bp = Blueprint("comisiones", __name__)


def _es_admin():
    return session.get("logged_in") and session.get("rol") in ("Admin", "Dueño")


def _nombre_usuario(username):
    if not username:
        return ""
    return usuarios_store.load_usuarios().get(username, {}).get("nombre", username)


@bp.route("/comisiones")
def listar():
    if not _es_admin():
        return redirect(url_for("login.login"))

    desde = request.args.get("desde", "").strip()
    hasta = request.args.get("hasta", "").strip()

    facturas = facturas_store.load_facturas()
    resumen = {}
    detalle = []
    for numero, f in facturas.items():
        fecha = str(f.get("fecha", ""))
        if desde and fecha < desde:
            continue
        if hasta and fecha > hasta:
            continue
        comision = round(float(f.get("comision_monto", 0) or 0), 2)
        if comision <= 0:
            continue

        key = f.get("vendedor_username") or f.get("vendedor") or "Sin vendedor"
        nombre = _nombre_usuario(f.get("vendedor_username")) or f.get("vendedor") or key
        total = round(float(f.get("total", 0) or 0), 2)

        grupo = resumen.setdefault(
            key,
            {
                "nombre": nombre,
                "ventas": 0,
                "total_vendido": 0.0,
                "comision": 0.0,
            },
        )
        grupo["ventas"] += 1
        grupo["total_vendido"] = round(grupo["total_vendido"] + total, 2)
        grupo["comision"] = round(grupo["comision"] + comision, 2)

        detalle.append(
            {
                "numero": numero,
                "fecha": fecha,
                "cliente": (f.get("cliente") or {}).get("nombre", ""),
                "vendedor": grupo["nombre"],
                "total": total,
                "comision": comision,
            }
        )

    detalle.sort(key=lambda d: (d["fecha"], d["numero"]), reverse=True)
    resumen_ordenado = sorted(
        resumen.values(), key=lambda g: g["comision"], reverse=True
    )
    total_general = round(sum(g["comision"] for g in resumen.values()), 2)

    return render_template(
        "comisiones.html",
        resumen=resumen_ordenado,
        detalle=detalle,
        total_general=total_general,
        desde=desde,
        hasta=hasta,
    )
