from flask import Blueprint, redirect, render_template, session, url_for

from routes import inventario_store

bp = Blueprint("dashboard", __name__)


@bp.route("/dashboard")
def dashboard():
    if not session.get("logged_in"):
        return redirect(url_for("login.login"))

    nombre = session.get("nombre")
    rol = session.get("rol")
    stock_bajo = inventario_store.stock_bajo()

    # Contenido exclusivo según el rol
    admin_panel_html = ""
    if rol in ("Admin", "Dueño"):
        admin_panel_html = """
        <div class="col-md-4">
            <a href="/usuarios" class="text-decoration-none">
                <div class="card card-module p-4 text-center border-danger">
                    <i class="fas fa-user-shield text-danger fa-3x mb-3"></i>
                    <h5 class="fw-bold text-dark">Gestión de Usuarios</h5>
                    <p class="text-muted small">Registrar y administrar accesos del personal.</p>
                </div>
            </a>
        </div>
        <div class="col-md-4">
            <a href="/comisiones" class="text-decoration-none">
                <div class="card card-module p-4 text-center border-success">
                    <i class="fas fa-hand-holding-usd text-success fa-3x mb-3"></i>
                    <h5 class="fw-bold text-dark">Comisiones por Venta</h5>
                    <p class="text-muted small">Reporte de comisiones ganadas por cada colaborador.</p>
                </div>
            </a>
        </div>
        <div class="col-md-4">
            <a href="/auditoria" class="text-decoration-none">
                <div class="card card-module p-4 text-center border-secondary">
                    <i class="fas fa-clipboard-list text-secondary fa-3x mb-3"></i>
                    <h5 class="fw-bold text-dark">Auditoría de Accesos</h5>
                    <p class="text-muted small">Quién entró al sistema y cuándo. Solo administradores.</p>
                </div>
            </a>
        </div>
        """

    return render_template(
        "dashboard.html",
        nombre=nombre,
        rol=rol,
        admin_panel_html=admin_panel_html,
        stock_bajo=stock_bajo,
    )
