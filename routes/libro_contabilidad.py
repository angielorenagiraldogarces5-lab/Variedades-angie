from datetime import date

from flask import Blueprint, redirect, render_template, request, session, url_for

from routes import fiados_store

bp = Blueprint("libro_contabilidad", __name__)


def _logueado():
    return session.get("logged_in")


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


def _construir_libro():
    fiados = fiados_store.load_fiados()
    clientes = {}

    for f in fiados.values():
        cid = str(f.get("cliente", {}).get("id", ""))
        if not cid:
            nombre = f.get("cliente", {}).get("nombre", "Sin nombre")
            cid = f"_{nombre}"
        if cid not in clientes:
            cli = f.get("cliente", {})
            clientes[cid] = {
                "id": cid,
                "nombre": cli.get("nombre", "Sin nombre"),
                "telefono": cli.get("telefono", ""),
                "direccion": cli.get("direccion", ""),
                "total_fiados": 0,
                "total_deuda": 0.0,
                "total_pagado": 0.0,
                "saldo_pendiente": 0.0,
                "tiene_mora": False,
                "fiados_detalle": [],
            }
        c = clientes[cid]
        c["total_fiados"] += 1
        c["total_deuda"] = round(c["total_deuda"] + float(f.get("total", 0)), 2)
        c["total_pagado"] = round(c["total_pagado"] + float(f.get("total_pagado", 0)), 2)
        c["saldo_pendiente"] = round(c["saldo_pendiente"] + float(f.get("saldo_pendiente", 0)), 2)
        c["fiados_detalle"].append({
            "numero": f.get("numero"),
            "fecha": f.get("fecha"),
            "total": float(f.get("total", 0)),
            "pagado": float(f.get("total_pagado", 0)),
            "saldo": float(f.get("saldo_pendiente", 0)),
            "estado": f.get("estado", "Pendiente"),
        })
        if f.get("estado") != "Pagado":
            for fr in f.get("fechas_ruta", []):
                if not fr.get("cobrado"):
                    fecha_lim = _parsear_fecha(fr.get("fecha"))
                    if fecha_lim and fecha_lim < date.today():
                        c["tiene_mora"] = True
                        break

    for c in clientes.values():
        del c["fiados_detalle"]

    return sorted(clientes.values(), key=lambda x: x["saldo_pendiente"], reverse=True)


@bp.route("/libro-contabilidad")
def libro():
    if not _logueado():
        return redirect(url_for("login.login"))

    registros = _construir_libro()

    busqueda = request.args.get("q", "").strip().lower()
    if busqueda:
        registros = [r for r in registros if busqueda in r["nombre"].lower()]

    total_deuda = round(sum(r["total_deuda"] for r in registros), 2)
    total_pagado = round(sum(r["total_pagado"] for r in registros), 2)
    total_saldo = round(sum(r["saldo_pendiente"] for r in registros), 2)
    total_clientes = len(registros)
    total_morosos = sum(1 for r in registros if r["tiene_mora"])

    return render_template(
        "libro_contabilidad.html",
        registros=registros,
        total_deuda=total_deuda,
        total_pagado=total_pagado,
        total_saldo=total_saldo,
        total_clientes=total_clientes,
        total_morosos=total_morosos,
        busqueda=busqueda,
    )
