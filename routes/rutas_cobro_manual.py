from datetime import date, timedelta

from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import clientes_store, fiados_store, rutas_cobro_manual_store, usuarios_store
from utils import ahora, numero_whatsapp

bp = Blueprint("rutas_cobro_manual", __name__)


def _logueado():
    return session.get("logged_in")


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


@bp.route("/rutas-cobro-manual")
def listar():
    if not _logueado():
        return redirect(url_for("login.login"))

    hoy = date.today()
    filtro_estado = request.args.get("estado", "").strip()
    filtro_fecha = request.args.get("fecha", "").strip()

    rutas = rutas_cobro_manual_store.load_rutas()

    if filtro_estado:
        rutas = {k: v for k, v in rutas.items() if v.get("estado") == filtro_estado}

    if filtro_fecha:
        rutas = {k: v for k, v in rutas.items() if v.get("fecha") == filtro_fecha}

    rutas_ordenadas = sorted(rutas.values(), key=lambda r: r.get("fecha", ""), reverse=True)

    total_rutas = len(rutas_ordenadas)
    total_esperado = round(sum(r.get("total_esperado", 0) for r in rutas_ordenadas), 2)
    total_cobrado = round(sum(r.get("total_cobrado", 0) for r in rutas_ordenadas), 2)
    rutas_pendientes = sum(1 for r in rutas_ordenadas if r.get("estado") == "Pendiente")

    return render_template(
        "rutas_cobro_manual.html",
        rutas=rutas_ordenadas,
        total_rutas=total_rutas,
        total_esperado=total_esperado,
        total_cobrado=total_cobrado,
        rutas_pendientes=rutas_pendientes,
        filtro_estado=filtro_estado,
        filtro_fecha=filtro_fecha,
        fecha_hoy=hoy.isoformat(),
    )


@bp.route("/rutas-cobro-manual/nueva", methods=["GET", "POST"])
def nueva():
    if not _logueado():
        return redirect(url_for("login.login"))

    clientes = clientes_store.load_clientes()
    fiados = fiados_store.load_fiados()
    nombres_clientes = sorted(set(
        c.get("nombre", "") for c in clientes.values() if c.get("nombre")
    ))

    clientes_lista = []
    for cid, c in clientes.items():
        clientes_lista.append({
            "id": cid,
            "nombre": c.get("nombre", ""),
            "telefono": c.get("telefono", ""),
            "direccion": c.get("direccion", ""),
        })

    fiados_pendientes = []
    for numero, f in fiados.items():
        if f.get("estado") == "Pagado":
            continue
        cliente = f.get("cliente", {})
        saldo = round(float(f.get("saldo_pendiente", 0)), 2)
        if saldo <= 0:
            continue
        fiados_pendientes.append({
            "numero": numero,
            "cliente_nombre": cliente.get("nombre", ""),
            "cliente_id": cliente.get("id", ""),
            "cliente_telefono": cliente.get("telefono", ""),
            "cliente_direccion": cliente.get("direccion", ""),
            "saldo": saldo,
            "frecuencia": f.get("frecuencia", ""),
        })

    if request.method == "POST":
        fecha = request.form.get("fecha", "").strip()
        nombre = request.form.get("nombre", "").strip()
        observaciones = request.form.get("observaciones", "").strip()

        if not fecha:
            flash("La fecha es obligatoria.", "danger")
            return render_template("ruta_cobro_manual_nueva.html",
                                   clientes=nombres_clientes, clientes_lista=clientes_lista,
                                   fiados_pendientes=fiados_pendientes, fecha_hoy=date.today().isoformat(),
                                   usuarios=usuarios_store.load_usuarios())

        numero = rutas_cobro_manual_store.crear_ruta(
            fecha=fecha, nombre=nombre, observaciones=observaciones,
            creado_por=session.get("nombre", ""),
        )

        visitantes_raw = []
        i = 0
        while f"vn_nombre_{i}" in request.form:
            visitantes_raw.append({
                "cliente_id": request.form.get(f"vn_id_{i}", ""),
                "cliente_nombre": request.form.get(f"vn_nombre_{i}", ""),
                "cliente_telefono": request.form.get(f"vn_telefono_{i}", ""),
                "cliente_direccion": request.form.get(f"vn_direccion_{i}", ""),
                "monto": request.form.get(f"vn_monto_{i}", "0"),
                "notas": request.form.get(f"vn_notas_{i}", ""),
                "fiado_vinculado": request.form.get(f"vn_fiado_{i}", "") or None,
                "cobrador": request.form.get(f"vn_cobrador_{i}", "").strip(),
            })
            i += 1

        for v in visitantes_raw:
            if not v["cliente_nombre"].strip():
                continue
            rutas_cobro_manual_store.agregar_visitante(
                numero_ruta=numero,
                cliente_id=v["cliente_id"],
                cliente_nombre=v["cliente_nombre"],
                cliente_telefono=v["cliente_telefono"],
                cliente_direccion=v["cliente_direccion"],
                monto=v["monto"],
                notas=v["notas"],
                fiado_vinculado=v["fiado_vinculado"],
                cobrador=v["cobrador"],
            )

        flash(f"Ruta {numero} creada correctamente.", "success")
        return redirect(url_for("rutas_cobro_manual.ver", numero=numero))

    return render_template(
        "ruta_cobro_manual_nueva.html",
        clientes=nombres_clientes,
        clientes_lista=clientes_lista,
        fiados_pendientes=fiados_pendientes,
        fecha_hoy=date.today().isoformat(),
        usuarios=usuarios_store.load_usuarios(),
    )


@bp.route("/rutas-cobro-manual/<numero>")
def ver(numero):
    if not _logueado():
        return redirect(url_for("login.login"))

    ruta = rutas_cobro_manual_store.obtener_ruta(numero)
    if not ruta:
        flash("Ruta no encontrada.", "danger")
        return redirect(url_for("rutas_cobro_manual.listar"))

    visitantes = ruta.get("visitantes", [])
    total_cobrado = round(sum(float(v.get("monto_cobrado", 0)) for v in visitantes), 2)
    total_esperado = round(sum(float(v.get("monto", 0)) for v in visitantes), 2)
    pendientes = sum(1 for v in visitantes if v.get("estado") == "Pendiente")
    cobrados = sum(1 for v in visitantes if v.get("estado") == "Cobrado")

    dias_semana = {
        0: "Lunes", 1: "Martes", 2: "Miércoles", 3: "Jueves",
        4: "Viernes", 5: "Sábado", 6: "Domingo",
    }
    fecha_obj = _parsear_fecha(ruta.get("fecha"))
    nombre_dia = dias_semana.get(fecha_obj.weekday(), "") if fecha_obj else ""

    return render_template(
        "ruta_cobro_manual_ver.html",
        ruta=ruta,
        visitantes=visitantes,
        total_cobrado=total_cobrado,
        total_esperado=total_esperado,
        pendientes=pendientes,
        cobrados=cobrados,
        nombre_dia=nombre_dia,
        usuarios=usuarios_store.load_usuarios(),
    )


@bp.route("/rutas-cobro-manual/<numero>/agregar-visitante", methods=["POST"])
def agregar_visitante(numero):
    if not _logueado():
        return redirect(url_for("login.login"))

    cliente_id = request.form.get("cliente_id", "").strip()
    cliente_nombre = request.form.get("cliente_nombre", "").strip()
    cliente_telefono = request.form.get("cliente_telefono", "").strip()
    cliente_direccion = request.form.get("cliente_direccion", "").strip()
    monto = request.form.get("monto", "0").strip()
    notas = request.form.get("notas", "").strip()
    fiado_vinculado = request.form.get("fiado_vinculado", "").strip() or None
    cobrador = request.form.get("cobrador", "").strip()

    if not cliente_nombre:
        flash("El nombre del cliente es obligatorio.", "danger")
        return redirect(url_for("rutas_cobro_manual.ver", numero=numero))

    ok, msg = rutas_cobro_manual_store.agregar_visitante(
        numero_ruta=numero,
        cliente_id=cliente_id,
        cliente_nombre=cliente_nombre,
        cliente_telefono=cliente_telefono,
        cliente_direccion=cliente_direccion,
        monto=monto,
        notas=notas,
        fiado_vinculado=fiado_vinculado,
        cobrador=cobrador,
    )
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("rutas_cobro_manual.ver", numero=numero))


@bp.route("/rutas-cobro-manual/<numero>/eliminar-visitante/<int:n>", methods=["POST"])
def eliminar_visitante(numero, n):
    if not _logueado():
        return redirect(url_for("login.login"))

    ok, msg = rutas_cobro_manual_store.eliminar_visitante(numero, n)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("rutas_cobro_manual.ver", numero=numero))


@bp.route("/rutas-cobro-manual/<numero>/cobrar/<int:n>", methods=["POST"])
def cobrar_visitante(numero, n):
    if not _logueado():
        return redirect(url_for("login.login"))

    monto = request.form.get("monto_cobrado", "0").strip()
    ok, msg = rutas_cobro_manual_store.marcar_cobrado(numero, n, monto)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("rutas_cobro_manual.ver", numero=numero))


@bp.route("/rutas-cobro-manual/<numero>/no-cobrar/<int:n>", methods=["POST"])
def no_cobrar_visitante(numero, n):
    if not _logueado():
        return redirect(url_for("login.login"))

    motivo = request.form.get("motivo", "").strip()
    ok, msg = rutas_cobro_manual_store.marcar_no_cobrado(numero, n, motivo)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("rutas_cobro_manual.ver", numero=numero))


@bp.route("/rutas-cobro-manual/<numero>/mover/<int:n>/<direccion>", methods=["POST"])
def mover_visitante(numero, n, direccion):
    if not _logueado():
        return redirect(url_for("login.login"))
    if direccion not in ("arriba", "abajo"):
        flash("Dirección inválida.", "danger")
        return redirect(url_for("rutas_cobro_manual.ver", numero=numero))
    ok, msg = rutas_cobro_manual_store.mover_visitante(numero, n, direccion)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("rutas_cobro_manual.ver", numero=numero))


@bp.route("/rutas-cobro-manual/<numero>/editar", methods=["GET", "POST"])
def editar(numero):
    if not _logueado():
        return redirect(url_for("login.login"))

    ruta = rutas_cobro_manual_store.obtener_ruta(numero)
    if not ruta:
        flash("Ruta no encontrada.", "danger")
        return redirect(url_for("rutas_cobro_manual.listar"))

    if request.method == "POST":
        fecha = request.form.get("fecha", "").strip()
        nombre = request.form.get("nombre", "").strip()
        observaciones = request.form.get("observaciones", "").strip()

        if not fecha:
            flash("La fecha es obligatoria.", "danger")
            return render_template("ruta_cobro_manual_editar.html", ruta=ruta)

        ok, msg = rutas_cobro_manual_store.editar_ruta(
            numero, fecha=fecha, nombre=nombre, observaciones=observaciones,
        )
        flash(msg, "success" if ok else "danger")
        return redirect(url_for("rutas_cobro_manual.ver", numero=numero))

    return render_template("ruta_cobro_manual_editar.html", ruta=ruta)


@bp.route("/rutas-cobro-manual/<numero>/eliminar", methods=["POST"])
def eliminar(numero):
    if not _logueado():
        return redirect(url_for("login.login"))

    rol = session.get("rol", "")
    if rol not in ("Dueño", "Admin"):
        flash("No tenés permisos para eliminar rutas.", "danger")
        return redirect(url_for("rutas_cobro_manual.ver", numero=numero))

    ok, msg = rutas_cobro_manual_store.eliminar_ruta(numero)
    flash(msg, "success" if ok else "danger")
    return redirect(url_for("rutas_cobro_manual.listar"))
