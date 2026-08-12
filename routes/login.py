from flask import Blueprint, redirect, render_template, request, session, url_for

from routes.usuarios_store import verificar_usuario

bp = Blueprint("login", __name__)


@bp.route("/", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        usuario = verificar_usuario(username, password)
        if usuario:
            session["logged_in"] = True
            session["username"] = username
            session["nombre"] = usuario["nombre"]
            session["rol"] = usuario["rol"]
            return redirect(url_for("dashboard.dashboard"))
        else:
            error = "Usuario o contraseña incorrectos."

    return render_template("login.html", error=error)
