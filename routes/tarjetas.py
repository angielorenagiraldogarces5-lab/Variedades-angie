from collections import defaultdict

from flask import Blueprint, redirect, render_template, request, session, url_for

from routes import fiados_store
from routes.fiados import _anos_disponibles, _parsear_fecha

bp = Blueprint("tarjetas", __name__)


def _logueado():
    return session.get("logged_in")


def _agrupar_por_anio(fiados):
    grupos = defaultdict(list)
    for numero, f in fiados.items():
        fecha = _parsear_fecha(f.get("fecha"))
        if fecha:
            grupos[fecha.year].append((numero, f))
    for anio in grupos:
        grupos[anio].sort(key=lambda x: x[1].get("fecha", ""), reverse=True)
    return dict(sorted(grupos.items(), reverse=True))


@bp.route("/tarjetas")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    fiados_todos = fiados_store.load_fiados()
    anio_filtro = request.args.get("anio", "").strip()
    try:
        anio_filtro = int(anio_filtro) if anio_filtro else None
    except ValueError:
        anio_filtro = None
    if anio_filtro:
        fiados_filtrados = {
            num: f
            for num, f in fiados_todos.items()
            if _parsear_fecha(f.get("fecha"))
            and _parsear_fecha(f.get("fecha")).year == anio_filtro
        }
    else:
        fiados_filtrados = fiados_todos
    grupos = _agrupar_por_anio(fiados_filtrados)
    anos_disponibles = _anos_disponibles(fiados_todos)
    total_fiados = len(fiados_filtrados)
    total_monto = round(sum(float(f.get("total", 0)) for f in fiados_filtrados.values()), 2)
    total_pendiente = round(
        sum(float(f.get("saldo_pendiente", 0)) for f in fiados_filtrados.values()), 2
    )
    return render_template(
        "tarjetas.html",
        grupos=grupos,
        anio_filtro=anio_filtro,
        anos_disponibles=anos_disponibles,
        total_fiados=total_fiados,
        total_monto=total_monto,
        total_pendiente=total_pendiente,
    )
