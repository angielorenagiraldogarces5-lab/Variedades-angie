import csv
import io

from flask import (
    Blueprint,
    Response,
    render_template,
    request,
    session,
    redirect,
    url_for,
)

from routes import inventario_store, proveedores_store

bp = Blueprint("reposicion", __name__)


def _logueado():
    return session.get("logged_in")


def _mon(v):
    """Formatea un número como '1.234,56' para archivos CSV (Excel en español)."""
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        v = 0.0
    s = f"{v:.2f}"
    ent, dec = s.split(".")
    ent = f"{int(ent):,}".replace(",", ".")
    return f"{ent},{dec}"


def _csv(nombre_archivo, headers, filas):
    buf = io.StringIO()
    buf.write("\ufeff")
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(headers)
    writer.writerows(filas)
    return Response(
        buf.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )


def cantidad_sugerida(stock, stock_minimo):
    """Cantidad recomendada a pedir para volver al doble del stock mínimo."""
    return max(round(float(stock_minimo or 0) * 2 - float(stock or 0), 2), 0)


def _preparar_items():
    """Devuelve los productos por acabar, enriquecidos con datos para la vista."""
    items = []
    for pid, p in inventario_store.stock_bajo():
        stock = float(p.get("stock", 0) or 0)
        minimo = float(p.get("stock_minimo", 0) or 0)
        items.append(
            {
                "pid": pid,
                "p": p,
                "stock": stock,
                "stock_fisico": p.get("stock_fisico"),
                "minimo": minimo,
                "sugerida": cantidad_sugerida(stock, minimo),
                "agotado": stock <= 0,
            }
        )
    items.sort(key=lambda it: (it["stock"], it["p"].get("nombre", "").lower()))
    return items


def _armar_mensaje(items):
    lineas = ["Hola, necesito reponer la siguiente mercadería:"]
    for it in items:
        nombre = it["p"].get("nombre", "")
        if it["sugerida"] > 0:
            lineas.append(f"- {nombre}: {it['sugerida']:g} unidades")
        else:
            lineas.append(f"- {nombre}")
    return "\n".join(lineas)


@bp.route("/reposicion")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))

    items = _preparar_items()
    agotados = sum(1 for it in items if it["agotado"])
    costo_total = round(
        sum(
            float(it["p"].get("costo", 0) or 0) * it["sugerida"]
            for it in items
        ),
        2,
    )
    proveedores = proveedores_store.load_proveedores()
    con_telefono = [
        p for p in proveedores.values() if p.get("telefono")
    ]

    return render_template(
        "reposicion.html",
        items=items,
        agotados=agotados,
        stock_bajo_count=len(items) - agotados,
        costo_total=costo_total,
        proveedores=con_telefono or proveedores,
        con_telefono=con_telefono,
        mensaje_whatsapp=_armar_mensaje(items),
    )


@bp.route("/reposicion/exportar")
def exportar():
    if not _logueado():
        return redirect(url_for("login.login"))

    filas = []
    for it in _preparar_items():
        p = it["p"]
        filas.append(
            [
                it["pid"],
                p.get("nombre", ""),
                p.get("categoria", "") or "",
                f"{it['stock']:g}",
                f"{it['stock_fisico']:g}" if it["stock_fisico"] is not None else "",
                f"{it['minimo']:g}",
                f"{it['sugerida']:g}",
                "Agotado" if it["agotado"] else "Stock bajo",
                _mon(p.get("costo", 0) or 0),
                _mon((p.get("costo", 0) or 0) * it["sugerida"]),
            ]
        )
    return _csv(
        "reposicion.csv",
        ["ID", "Producto", "Categoría", "Stock", "Stock físico", "Stock mín.", "Cant. sugerida", "Estado", "Costo", "Costo estimado"],
        filas,
    )
