from flask import Blueprint, render_template

from routes import productos_store
from utils import formatear_moneda

bp = Blueprint("tienda", __name__)

NOMBRE_NEGOCIO = "Variedades Angie"
WHATSAPP_NUMERO = "5491123456789"


@bp.route("/tienda")
def tienda():
    productos = productos_store.load_productos()
    publicados = []
    for pid, p in productos.items():
        precio = float(p.get("precio", 0) or 0)
        if precio <= 0:
            continue
        publicados.append(
            {
                "id": pid,
                "nombre": p.get("nombre", ""),
                "categoria": p.get("categoria", "") or "General",
                "precio": precio,
                "precio_texto": formatear_moneda(precio),
            }
        )

    categorias = sorted(
        {p["categoria"] for p in publicados},
        key=str.lower,
    )
    return render_template(
        "tienda.html",
        nombre_negocio=NOMBRE_NEGOCIO,
        whatsapp=WHATSAPP_NUMERO,
        categorias=categorias,
        productos=publicados,
    )


@bp.route("/tienda/<categoria>")
def tienda_categoria(categoria):
    productos = productos_store.load_productos()
    publicados = []
    for pid, p in productos.items():
        precio = float(p.get("precio", 0) or 0)
        if precio <= 0:
            continue
        if (p.get("categoria") or "General") != categoria:
            continue
        publicados.append(
            {
                "id": pid,
                "nombre": p.get("nombre", ""),
                "categoria": p.get("categoria", "") or "General",
                "precio": precio,
                "precio_texto": formatear_moneda(precio),
            }
        )
    return render_template(
        "tienda.html",
        nombre_negocio=NOMBRE_NEGOCIO,
        whatsapp=WHATSAPP_NUMERO,
        categorias=[categoria],
        productos=publicados,
        categoria_seleccionada=categoria,
    )
