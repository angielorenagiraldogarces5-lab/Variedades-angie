import csv
import io

from flask import (
    Blueprint,
    Response,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from routes import inventario_store, productos_store
from utils import ahora

bp = Blueprint("inventario", __name__)


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


def _filtrar_movimientos(movimientos):
    """Aplica los filtros recibidos por query string a la lista de movimientos."""
    tipo_f = request.args.get("tipo", "").strip()
    pid_f = request.args.get("pid", "").strip()
    q_f = request.args.get("q", "").strip().lower()
    desde = request.args.get("desde", "").strip()
    hasta = request.args.get("hasta", "").strip()

    resultado = []
    for mid, m in sorted(movimientos.items(), key=lambda kv: int(kv[0]), reverse=True):
        if tipo_f and m.get("tipo") != tipo_f:
            continue
        if pid_f and str(m.get("pid", "")) != str(pid_f):
            continue
        if desde and (m.get("fecha") or "") < desde:
            continue
        if hasta and (m.get("fecha") or "") > hasta:
            continue
        if q_f:
            busqueda = " ".join(
                str(m.get(k, "")) for k in ("producto", "motivo", "usuario", "referencia")
            ).lower()
            if q_f not in busqueda:
                continue
        resultado.append((mid, m))
    return resultado


@bp.route("/inventario")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))

    movimientos = _filtrar_movimientos(inventario_store.load_movimientos())
    conteos = sorted(
        inventario_store.load_conteos().items(), key=lambda kv: int(kv[0]), reverse=True
    )
    stats = inventario_store.resumen_inventario()
    categorias = sorted(stats["categorias"].items(), key=lambda kv: kv[1]["valor"], reverse=True)

    return render_template(
        "inventario.html",
        movimientos=movimientos,
        conteos=conteos,
        productos=productos_store.load_productos(),
        stats=stats,
        categorias=categorias,
        stock_bajo=inventario_store.stock_bajo(),
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
        query=request.query_string.decode("utf-8"),
    )


@bp.route("/inventario/stock-fisico", methods=["POST"])
def guardar_stock_fisico():
    if not _logueado():
        return jsonify({"ok": False, "msg": "No autorizado."})

    pid = request.form.get("pid", "")
    stock_fisico = request.form.get("stock_fisico", "")
    ok, msg = productos_store.guardar_stock_fisico(pid, stock_fisico)
    return jsonify({"ok": ok, "msg": msg})


@bp.route("/inventario/movimiento", methods=["POST"])
def crear_movimiento():
    if not _logueado():
        return redirect(url_for("login.login"))

    tipo = request.form.get("tipo", "")
    pid = request.form.get("pid", "")
    cantidad = request.form.get("cantidad", "")
    motivo = request.form.get("motivo", "").strip()
    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")

    ok, msg = inventario_store.registrar_movimiento(
        tipo, pid, cantidad, motivo, fecha, session.get("nombre")
    )
    flash(
        "Movimiento registrado correctamente." if ok else msg,
        "success" if ok else "danger",
    )
    return redirect(url_for("inventario.listar"))


@bp.route("/inventario/movimiento/<mid>/eliminar", methods=["POST"])
def eliminar_movimiento(mid):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = inventario_store.eliminar_movimiento(mid)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("inventario.listar"))


@bp.route("/inventario/conteo", methods=["POST"])
def crear_conteo():
    if not _logueado():
        return redirect(url_for("login.login"))

    pid = request.form.get("pid", "")
    stock_real = request.form.get("stock_real", "")
    motivo = request.form.get("motivo", "").strip()
    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")

    ok, msg = inventario_store.registrar_conteo(
        pid, stock_real, motivo, fecha, session.get("nombre")
    )
    flash(
        "Conteo físico registrado correctamente." if ok else msg,
        "success" if ok else "danger",
    )
    return redirect(url_for("inventario.listar"))


@bp.route("/inventario/conteo/<cid>/eliminar", methods=["POST"])
def eliminar_conteo(cid):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = inventario_store.eliminar_conteo(cid)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("inventario.listar"))


@bp.route("/inventario/producto/<pid>")
def producto(pid):
    if not _logueado():
        return redirect(url_for("login.login"))

    productos = productos_store.load_productos()
    p = productos.get(str(pid))
    if not p:
        flash("El producto no existe.", "danger")
        return redirect(url_for("inventario.listar"))

    movimientos = sorted(
        (
            (mid, m)
            for mid, m in inventario_store.load_movimientos().items()
            if str(m.get("pid", "")) == str(pid)
        ),
        key=lambda kv: int(kv[0]),
        reverse=True,
    )
    conteos = sorted(
        (
            (cid, c)
            for cid, c in inventario_store.load_conteos().items()
            if str(c.get("pid", "")) == str(pid)
        ),
        key=lambda kv: int(kv[0]),
        reverse=True,
    )
    stock = float(p.get("stock", 0) or 0)
    costo = float(p.get("costo", 0) or 0)

    return render_template(
        "inventario_producto.html",
        pid=str(pid),
        p=p,
        movimientos=movimientos,
        conteos=conteos,
        valor=round(stock * costo, 2),
    )


@bp.route("/inventario/exportar/stock")
def exportar_stock():
    if not _logueado():
        return redirect(url_for("login.login"))

    filas = []
    for pid, p in productos_store.load_productos().items():
        stock = float(p.get("stock", 0) or 0)
        costo = float(p.get("costo", 0) or 0)
        filas.append(
            [
                pid,
                p.get("nombre", ""),
                p.get("categoria", "") or "",
                f"{stock:g}",
                f"{float(p.get('stock_minimo', 0) or 0):g}",
                "Sí" if p.get("control_stock", False) else "No",
                _mon(costo),
                _mon(stock * costo),
            ]
        )
    return _csv(
        "stock_actual.csv",
        ["ID", "Producto", "Categoría", "Stock", "Stock mínimo", "Control stock", "Costo", "Valor total"],
        filas,
    )


@bp.route("/inventario/exportar/movimientos")
def exportar_movimientos():
    if not _logueado():
        return redirect(url_for("login.login"))

    filas = [
        [
            mid,
            m.get("fecha", ""),
            m.get("tipo", ""),
            m.get("producto", ""),
            f"{float(m.get('cantidad', 0) or 0):g}",
            m.get("motivo", ""),
            m.get("referencia", ""),
            m.get("usuario", ""),
        ]
        for mid, m in _filtrar_movimientos(inventario_store.load_movimientos())
    ]
    return _csv(
        "movimientos.csv",
        ["ID", "Fecha", "Tipo", "Producto", "Cantidad", "Motivo", "Referencia", "Usuario"],
        filas,
    )
