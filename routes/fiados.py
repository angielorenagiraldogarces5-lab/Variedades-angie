from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import facturas_store, fiados_store
from utils import ahora

bp = Blueprint("fiados", __name__)


def _logueado():
    return session.get("logged_in")


def _fiados_existentes():
    return {
        f.get("factura_origen")
        for f in fiados_store.load_fiados().values()
        if f.get("factura_origen")
    }


@bp.route("/fiados")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    return render_template(
        "fiados.html",
        fiados=fiados_store.load_fiados(),
        rol=session.get("rol"),
    )


@bp.route("/fiados/nuevo")
def nuevo():
    if not _logueado():
        return redirect(url_for("login.login"))
    facturas = facturas_store.load_facturas()
    con_fiado = _fiados_existentes()
    disponibles = {
        numero: f
        for numero, f in facturas.items()
        if numero not in con_fiado
    }
    seleccionada = request.args.get("factura", "").strip()
    factura = disponibles.get(seleccionada)
    return render_template(
        "nuevo_fiado.html",
        facturas=disponibles,
        factura=factura,
        frecuencias=fiados_store.FRECUENCIAS,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/fiados/crear", methods=["POST"])
def crear():
    if not _logueado():
        return redirect(url_for("login.login"))

    factura_numero = request.form.get("factura_numero", "").strip()
    factura = facturas_store.load_facturas().get(factura_numero)
    if not factura:
        flash("Debe seleccionar una factura o boleta válida.", "danger")
        return redirect(url_for("fiados.nuevo"))
    if factura_numero in _fiados_existentes():
        flash("Ese comprobante ya tiene un fiado registrado.", "danger")
        return redirect(url_for("fiados.nuevo"))

    try:
        n_cuotas = int(request.form.get("n_cuotas", 1) or 1)
    except ValueError:
        n_cuotas = 1
    if n_cuotas < 1:
        n_cuotas = 1

    frecuencia = request.form.get("frecuencia", "Semanal")
    if frecuencia not in fiados_store.FRECUENCIAS:
        frecuencia = "Semanal"

    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    fecha_inicio = request.form.get("fecha_inicio", "").strip() or fecha

    numero = fiados_store.crear_fiado(
        fecha,
        factura,
        n_cuotas,
        frecuencia,
        fecha_inicio,
        session.get("nombre"),
    )

    flash(f"Fiado {numero} creado correctamente.", "success")
    return redirect(url_for("fiados.ver", numero=numero))


@bp.route("/fiados/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    fiado = fiados_store.load_fiados().get(numero)
    if not fiado:
        flash("El fiado no existe.", "danger")
        return redirect(url_for("fiados.listar"))
    factura = facturas_store.load_facturas().get(fiado.get("factura_origen"))
    return render_template(
        "fiado.html",
        fiado=fiado,
        factura=factura,
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/fiados/<numero>/abono", methods=["POST"])
def abonar(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
    monto = request.form.get("monto", "").strip()
    ok, msg = fiados_store.registrar_abono(numero, fecha, monto, session.get("nombre"))
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("fiados.ver", numero=numero))


@bp.route("/fiados/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = fiados_store.eliminar_fiado(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("fiados.listar"))
