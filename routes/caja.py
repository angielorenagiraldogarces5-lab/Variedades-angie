from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import caja_store
from utils import ahora

bp = Blueprint("caja", __name__)


def _logueado():
    return session.get("logged_in")


@bp.route("/caja")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))
    return render_template(
        "caja.html",
        cajas=caja_store.load_cajas(),
        abierta=caja_store.caja_abierta(),
        rol=session.get("rol"),
    )


@bp.route("/caja/abrir", methods=["GET", "POST"])
def abrir():
    if not _logueado():
        return redirect(url_for("login.login"))
    if caja_store.caja_abierta():
        flash("Ya existe una caja abierta. Debe cerrarla para abrir una nueva.", "danger")
        return redirect(url_for("caja.listar"))
    if request.method == "POST":
        fecha = request.form.get("fecha", "").strip() or ahora().strftime("%Y-%m-%d")
        monto_inicial = request.form.get("monto_inicial", "0").strip()
        observacion = request.form.get("observacion", "").strip()
        ok, msg = caja_store.abrir_caja(
            fecha, monto_inicial, session.get("nombre"), observacion
        )
        flash(msg, "success" if ok else "danger")
        if ok:
            return redirect(url_for("caja.ver", numero=msg))
        return redirect(url_for("caja.abrir"))
    return render_template(
        "caja_abrir.html",
        fecha_hoy=ahora().strftime("%Y-%m-%d"),
    )


@bp.route("/caja/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    caja = caja_store.load_cajas().get(numero)
    if not caja:
        flash("La caja no existe.", "danger")
        return redirect(url_for("caja.listar"))
    return render_template(
        "caja_ver.html",
        caja=caja,
        conceptos_ingreso=caja_store.CONCEPTOS_INGRESO,
        conceptos_egreso=caja_store.CONCEPTOS_EGRESO,
    )


@bp.route("/caja/<numero>/movimiento", methods=["POST"])
def movimiento(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    tipo = request.form.get("tipo", "Ingreso")
    concepto = request.form.get("concepto", "")
    if concepto == "__otro__":
        concepto = request.form.get("concepto_otro", "").strip()
    monto = request.form.get("monto", "").strip()
    ok, msg = caja_store.registrar_movimiento(
        numero, tipo, concepto, monto, session.get("nombre")
    )
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("caja.ver", numero=numero))


@bp.route("/caja/<numero>/movimiento/<int:n>/eliminar", methods=["POST"])
def eliminar_movimiento(numero, n):
    if not _logueado():
        return redirect(url_for("login.login"))
    ok, msg = caja_store.eliminar_movimiento(numero, n)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("caja.ver", numero=numero))


@bp.route("/caja/<numero>/cierre", methods=["POST"])
def cerrar(numero):
    if not _logueado():
        return redirect(url_for("login.login"))
    monto_contado = request.form.get("monto_contado", "").strip()
    observacion = request.form.get("observacion", "").strip()
    ok, msg = caja_store.cerrar_caja(
        numero, monto_contado, observacion, session.get("nombre")
    )
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("caja.ver", numero=numero))


@bp.route("/caja/<numero>/reabrir", methods=["POST"])
def reabrir(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = caja_store.reabrir_caja(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("caja.ver", numero=numero))


@bp.route("/caja/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado() or session.get("rol") not in ("Admin", "Dueño"):
        return redirect(url_for("login.login"))
    ok, msg = caja_store.eliminar_caja(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("caja.listar"))
