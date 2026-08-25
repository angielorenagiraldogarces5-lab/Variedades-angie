from flask import Blueprint, current_app, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from routes import (
    caja_store,
    clientes_store,
    facturas_store,
    inventario_store,
    productos_store,
    usuarios_store,
)
from utils import ahora, formatear_moneda, hoy

bp = Blueprint("api", __name__, url_prefix="/api")

TOKEN_MAX_AGE = 60 * 60 * 24 * 30  # 30 días


def _serializer():
    return URLSafeTimedSerializer(current_app.secret_key, salt="api-token")


def _generar_token(username):
    return _serializer().dumps({"username": username})


def _usuario_desde_token():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        datos = _serializer().loads(token, max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    username = datos.get("username")
    usuarios = usuarios_store.load_usuarios()
    usuario = usuarios.get(username)
    if not usuario:
        return None
    return {"username": username, **usuario}


def _requiere_auth():
    usuario = _usuario_desde_token()
    if not usuario:
        return None
    return usuario


def _producto_json(pid, p):
    return {
        "id": str(pid),
        "codigo": p.get("codigo"),
        "nombre": p.get("nombre", ""),
        "categoria": p.get("categoria", ""),
        "precio": round(float(p.get("precio", 0) or 0), 2),
        "costo": round(float(p.get("costo", 0) or 0), 2),
        "stock": round(float(p.get("stock", 0) or 0), 2),
        "stock_minimo": round(float(p.get("stock_minimo", 0) or 0), 2),
        "control_stock": bool(p.get("control_stock", False)),
        "precio_texto": formatear_moneda(p.get("precio", 0) or 0),
    }


@bp.route("/login", methods=["POST"])
def login():
    datos = request.get_json(silent=True) or {}
    username = str(datos.get("username", "")).strip()
    password = str(datos.get("password", ""))
    usuario = usuarios_store.verificar_usuario(username, password)
    if not usuario:
        return jsonify({"ok": False, "error": "Usuario o contraseña incorrectos."}), 401
    return jsonify(
        {
            "ok": True,
            "token": _generar_token(username),
            "usuario": {
                "username": username,
                "nombre": usuario["nombre"],
                "rol": usuario["rol"],
                "comision": float(usuario.get("comision", 0) or 0),
            },
        }
    )


@bp.route("/me")
def me():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    return jsonify(
        {
            "ok": True,
            "usuario": {
                "username": usuario["username"],
                "nombre": usuario["nombre"],
                "rol": usuario["rol"],
                "comision": float(usuario.get("comision", 0) or 0),
            },
        }
    )


@bp.route("/dashboard")
def dashboard():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401

    fecha_hoy = hoy().strftime("%Y-%m-%d")
    facturas = facturas_store.load_facturas()
    ventas_hoy = [f for f in facturas.values() if str(f.get("fecha", ""))[:10] == fecha_hoy]
    total_ventas_hoy = round(sum(float(f.get("total", 0) or 0) for f in ventas_hoy), 2)

    caja = caja_store.caja_abierta()
    caja_json = None
    if caja:
        caja_json = {
            "numero": caja.get("numero"),
            "fecha": caja.get("fecha"),
            "apertura": caja.get("apertura"),
            "cajero": caja.get("cajero"),
            "monto_inicial": caja.get("monto_inicial"),
            "total_ingresos": caja.get("total_ingresos"),
            "total_egresos": caja.get("total_egresos"),
            "total_esperado": caja.get("total_esperado"),
            "movimientos": caja.get("movimientos", []),
        }

    stock_bajo = [
        {
            "id": pid,
            "nombre": p.get("nombre", ""),
            "stock": round(float(p.get("stock", 0) or 0), 2),
            "stock_minimo": round(float(p.get("stock_minimo", 0) or 0), 2),
        }
        for pid, p in inventario_store.stock_bajo()
    ]

    mes = fecha_hoy[:7]
    ventas_mes = [
        f for f in facturas.values() if str(f.get("fecha", ""))[:7] == mes
    ]

    return jsonify(
        {
            "ok": True,
            "usuario": {
                "username": usuario["username"],
                "nombre": usuario["nombre"],
                "rol": usuario["rol"],
            },
            "dashboard": {
                "ventas_hoy": len(ventas_hoy),
                "total_ventas_hoy": total_ventas_hoy,
                "ventas_mes": len(ventas_mes),
                "total_ventas_mes": round(
                    sum(float(f.get("total", 0) or 0) for f in ventas_mes), 2
                ),
                "productos_total": len(productos_store.load_productos()),
                "clientes_total": len(clientes_store.load_clientes()),
                "stock_bajo_count": len(stock_bajo),
                "stock_bajo": stock_bajo,
                "caja": caja_json,
            },
        }
    )


@bp.route("/categorias")
def categorias():
    grupos = productos_store.agrupar_por_categoria()
    return jsonify(
        {
            "ok": True,
            "categorias": [
                {
                    "nombre": cat,
                    "cantidad": len(items),
                    "valor": round(
                        sum(
                            float(p.get("costo", 0) or 0)
                            * float(p.get("stock", 0) or 0)
                            for _, p in items
                        ),
                        2,
                    ),
                }
                for cat, items in grupos
            ],
        }
    )


@bp.route("/productos")
def listar_productos():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401

    productos = productos_store.load_productos()
    q = (request.args.get("q", "") or "").strip().lower()
    categoria = (request.args.get("categoria", "") or "").strip()

    resultado = []
    for pid, p in productos.items():
        if q and q not in str(p.get("nombre", "")).lower():
            continue
        if categoria and (p.get("categoria") or "") != categoria:
            continue
        resultado.append(_producto_json(pid, p))

    resultado.sort(key=lambda x: x["nombre"].lower())
    return jsonify({"ok": True, "productos": resultado})


@bp.route("/productos/<pid>")
def ver_producto(pid):
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    productos = productos_store.load_productos()
    p = productos.get(str(pid))
    if not p:
        return jsonify({"ok": False, "error": "El producto no existe."}), 404
    return jsonify({"ok": True, "producto": _producto_json(pid, p)})


@bp.route("/productos/codigo/<codigo>")
def producto_por_codigo(codigo):
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    pid, p = productos_store.buscar_por_codigo(codigo)
    if not p:
        return jsonify({"ok": False, "error": "No se encontró ningún producto con ese código."}), 404
    return jsonify({"ok": True, "producto": _producto_json(pid, p)})


@bp.route("/clientes")
def listar_clientes():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    clientes = clientes_store.load_clientes()
    q = (request.args.get("q", "") or "").strip().lower()
    resultado = []
    for cid, c in clientes.items():
        if q and q not in str(c.get("nombre", "")).lower():
            continue
        resultado.append(
            {"id": cid, "nombre": c.get("nombre", ""), "telefono": c.get("telefono", "")}
        )
    resultado.sort(key=lambda x: x["nombre"].lower())
    return jsonify({"ok": True, "clientes": resultado})


@bp.route("/clientes", methods=["POST"])
def crear_cliente():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    datos = request.get_json(silent=True) or {}
    nombre = str(datos.get("nombre", "")).strip()
    if not nombre:
        return jsonify({"ok": False, "error": "El nombre del cliente es obligatorio."}), 400
    ok, msg = clientes_store.crear_cliente(
        nombre,
        str(datos.get("documento", "")).strip(),
        str(datos.get("telefono", "")).strip(),
        str(datos.get("direccion", "")).strip(),
    )
    if not ok:
        return jsonify({"ok": False, "error": msg}), 400
    return jsonify({"ok": True, "cliente_id": msg})


@bp.route("/facturas")
def listar_facturas():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    facturas = facturas_store.load_facturas()
    resultado = []
    for numero, f in facturas.items():
        resultado.append(
            {
                "numero": numero,
                "tipo": f.get("tipo", ""),
                "fecha": f.get("fecha", ""),
                "cliente": f.get("cliente", {}).get("nombre", ""),
                "total": round(float(f.get("total", 0) or 0), 2),
                "estado": f.get("estado", ""),
                "forma_pago": f.get("forma_pago", ""),
                "vendedor": f.get("vendedor", ""),
            }
        )
    resultado.sort(key=lambda x: x["numero"], reverse=True)
    return jsonify({"ok": True, "facturas": resultado})


@bp.route("/facturas/<numero>")
def ver_factura(numero):
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    factura = facturas_store.load_facturas().get(numero)
    if not factura:
        return jsonify({"ok": False, "error": "El comprobante no existe."}), 404
    return jsonify({"ok": True, "factura": factura})


@bp.route("/facturas", methods=["POST"])
def crear_factura():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    datos = request.get_json(silent=True) or {}

    tipo = str(datos.get("tipo", "Factura"))
    if tipo not in facturas_store.TIPOS:
        return jsonify({"ok": False, "error": "Tipo de comprobante no válido."}), 400
    fecha = str(datos.get("fecha", "")).strip() or ahora().strftime("%Y-%m-%d")
    estado = str(datos.get("estado", "Pagada"))
    observacion = str(datos.get("observacion", "")).strip()
    forma_pago = str(datos.get("forma_pago", "Efectivo"))
    if forma_pago not in facturas_store.FORMAS_PAGO:
        return jsonify({"ok": False, "error": "Forma de pago no válida."}), 400
    if forma_pago in ("Crédito", "Fiado") and estado == "Pagada":
        estado = "Pendiente"

    # Cliente: por id, por datos nuevos, o cliente suelto
    cliente = None
    cliente_data = datos.get("cliente")
    if isinstance(cliente_data, dict) and cliente_data.get("id"):
        cliente = clientes_store.buscar_cliente(cliente_data["id"])
        if not cliente:
            return jsonify({"ok": False, "error": "El cliente seleccionado no existe."}), 400
        cliente = {"id": str(cliente_data["id"]), **cliente}
    elif isinstance(cliente_data, dict) and cliente_data.get("nombre"):
        nombre = str(cliente_data["nombre"]).strip()
        if not nombre:
            return jsonify({"ok": False, "error": "Debe indicar el cliente."}), 400
        ok, msg = clientes_store.crear_cliente(
            nombre,
            str(cliente_data.get("documento", "")).strip(),
            str(cliente_data.get("telefono", "")).strip(),
            str(cliente_data.get("direccion", "")).strip(),
        )
        if not ok:
            return jsonify({"ok": False, "error": msg}), 400
        cliente = {
            "id": msg,
            "nombre": nombre,
            "documento": str(cliente_data.get("documento", "")).strip(),
            "telefono": str(cliente_data.get("telefono", "")).strip(),
            "direccion": str(cliente_data.get("direccion", "")).strip(),
        }

    if not cliente:
        return jsonify({"ok": False, "error": "Debe indicar un cliente."}), 400

    # Items: por pid/codigo o por descripcion
    items_raw = datos.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return jsonify({"ok": False, "error": "Debe incluir al menos un producto."}), 400

    productos = productos_store.load_productos()
    items = []
    for raw in items_raw:
        if not isinstance(raw, dict):
            continue
        try:
            cantidad = float(raw.get("cantidad", 0) or 0)
            precio = float(raw.get("precio", 0) or 0)
        except (TypeError, ValueError):
            continue
        if cantidad <= 0 or precio < 0:
            continue

        pid = str(raw.get("pid", "") or "")
        codigo = str(raw.get("codigo", "") or "")
        descripcion = str(raw.get("descripcion", "")).strip()
        if pid:
            producto = productos.get(pid)
        elif codigo:
            pid, producto = productos_store.buscar_por_codigo(codigo)
        else:
            pid, producto = None, None
        if producto:
            descripcion = descripcion or producto.get("nombre", "")
        if not descripcion:
            continue

        item = {
            "descripcion": descripcion,
            "cantidad": round(cantidad, 2),
            "precio": round(precio, 2),
            "subtotal": round(cantidad * precio, 2),
        }
        if pid and productos.get(pid, {}).get("control_stock", False):
            stock = float(productos[pid].get("stock", 0) or 0)
            if stock < cantidad:
                return jsonify(
                    {
                        "ok": False,
                        "error": f"Stock insuficiente de '{descripcion}': disponible {stock:g}, requerido {cantidad:g}.",
                    }
                ), 400
            item["pid"] = pid
        items.append(item)

    if not items:
        return jsonify({"ok": False, "error": "Debe incluir al menos un producto válido."}), 400

    numero = facturas_store.crear_factura(
        tipo,
        fecha,
        cliente,
        items,
        estado,
        observacion,
        usuario.get("nombre"),
        forma_pago,
        vendedor_username=usuario.get("username", ""),
        comision_pct=usuarios_store.load_usuarios()
        .get(usuario.get("username", ""), {})
        .get("comision", 0),
    )

    for item in items:
        if item.get("pid"):
            inventario_store.registrar_salida(
                item["pid"],
                item["cantidad"],
                f"Venta {tipo.lower()} {numero}",
                fecha,
                usuario.get("nombre"),
                referencia=numero,
            )

    return jsonify({"ok": True, "numero": numero, "factura": facturas_store.load_facturas().get(numero)})


@bp.route("/facturas/<numero>/estado", methods=["POST"])
def cambiar_estado(numero):
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    datos = request.get_json(silent=True) or {}
    estado = str(datos.get("estado", ""))
    ok, msg = facturas_store.actualizar_estado(numero, estado)
    if not ok:
        return jsonify({"ok": False, "error": msg}), 400
    return jsonify({"ok": True, "mensaje": msg})


@bp.route("/caja/actual")
def caja_actual():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    caja = caja_store.caja_abierta()
    if not caja:
        return jsonify({"ok": True, "caja": None})
    return jsonify({"ok": True, "caja": caja})


@bp.route("/caja/movimiento", methods=["POST"])
def caja_movimiento():
    usuario = _requiere_auth()
    if not usuario:
        return jsonify({"ok": False, "error": "No autorizado."}), 401
    caja = caja_store.caja_abierta()
    if not caja:
        return jsonify({"ok": False, "error": "No hay una caja abierta."}), 400
    datos = request.get_json(silent=True) or {}
    tipo = str(datos.get("tipo", "Ingreso"))
    concepto = str(datos.get("concepto", "")).strip()
    monto = str(datos.get("monto", "")).strip()
    ok, msg = caja_store.registrar_movimiento(
        caja["numero"], tipo, concepto, monto, usuario.get("nombre")
    )
    if not ok:
        return jsonify({"ok": False, "error": msg}), 400
    return jsonify({"ok": True, "mensaje": msg})


@bp.route("/tienda/productos")
def tienda_productos():
    """Catálogo público para clientes: solo productos con precio publicado (>0)."""
    productos = productos_store.load_productos()
    resultado = []
    for pid, p in productos.items():
        precio = float(p.get("precio", 0) or 0)
        if precio <= 0:
            continue
        resultado.append(
            {
                "id": str(pid),
                "nombre": p.get("nombre", ""),
                "categoria": p.get("categoria", "") or "General",
                "precio": round(precio, 2),
                "precio_texto": formatear_moneda(precio),
            }
        )
    resultado.sort(key=lambda x: x["nombre"].lower())
    return jsonify({"ok": True, "productos": resultado})


@bp.route("/tienda/info")
def tienda_info():
    productos = productos_store.load_productos()
    categorias = sorted(
        {p.get("categoria") or "General" for p in productos.values()},
        key=str.lower,
    )
    return jsonify(
        {
            "ok": True,
            "info": {
                "nombre_negocio": "Variedades Angie",
                "categorias": categorias,
                "productos_publicados": sum(
                    1 for p in productos.values() if float(p.get("precio", 0) or 0) > 0
                ),
            },
        }
    )
