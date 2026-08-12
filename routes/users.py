from flask import Blueprint, flash, redirect, render_template, request, session, url_for

from routes import usuarios_store

bp = Blueprint("usuarios", __name__)


def _es_admin():
    return session.get("logged_in") and session.get("rol") in ("Admin", "Dueño")


@bp.route("/usuarios")
def listar():
    if not _es_admin():
        return redirect(url_for("login.login"))
    usuarios = usuarios_store.load_usuarios()
    return render_template(
        "usuarios.html",
        usuarios=usuarios,
        sesion_user=session.get("username"),
    )


@bp.route("/usuarios/crear", methods=["POST"])
def crear():
    if not _es_admin():
        return redirect(url_for("login.login"))

    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    nombre = request.form.get("nombre", "").strip()
    rol = request.form.get("rol", "Trabajador")
    comision = request.form.get("comision", "0")

    if not username or not password or not nombre:
        flash("Todos los campos son obligatorios.", "danger")
    else:
        ok, msg = usuarios_store.crear_usuario(username, password, nombre, rol, comision)
        flash(msg, "success" if ok else "danger")

    return redirect(url_for("usuarios.listar"))


@bp.route("/usuarios/editar/<username>", methods=["POST"])
def editar(username):
    if not _es_admin():
        return redirect(url_for("login.login"))

    password = request.form.get("password", "").strip()
    nombre = request.form.get("nombre", "").strip()
    rol = request.form.get("rol", "").strip()
    comision = request.form.get("comision", "").strip()

    if not nombre or not rol:
        flash("El nombre y el rol son obligatorios.", "danger")
    else:
        ok, msg = usuarios_store.actualizar_usuario(
            username,
            password=password or None,
            nombre=nombre,
            rol=rol,
            comision=comision or None,
        )
        flash(msg, "success" if ok else "danger")

    return redirect(url_for("usuarios.listar"))


@bp.route("/usuarios/eliminar/<username>", methods=["POST"])
def eliminar(username):
    if not _es_admin():
        return redirect(url_for("login.login"))

    if username == session.get("username"):
        flash("No puedes eliminar tu propia cuenta.", "danger")
        return redirect(url_for("usuarios.listar"))

    ok, msg = usuarios_store.eliminar_usuario(username)
    flash(msg, "success" if ok else "danger")

    return redirect(url_for("usuarios.listar"))
