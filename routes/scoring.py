from datetime import date, timedelta

from routes import clientes_store, fiados_store


UMBRAL_APROBADO = 70
UMBRAL_REVISION = 40


def _parsear_fecha(valor):
    try:
        return date.fromisoformat(valor or "")
    except (TypeError, ValueError):
        return None


def calcular_score(cliente, cliente_id=None):
    cid = cliente_id or cliente.get("id")
    fiados = fiados_store.load_fiados()

    total_fiados = 0
    fiados_pagados = 0
    fiados_con_mora = 0
    fechas_vencidas = 0
    saldo_total = 0.0
    hoy = date.today()

    for f in fiados.values():
        if str(f.get("cliente", {}).get("id", "")) != str(cid):
            continue
        total_fiados += 1
        if f.get("estado") == "Pagado":
            fiados_pagados += 1
        else:
            saldo_total += float(f.get("saldo_pendiente", 0))
            for fr in f.get("fechas_ruta", []):
                if fr.get("cobrado"):
                    continue
                fecha_limite = _parsear_fecha(fr.get("fecha"))
                if fecha_limite and fecha_limite < hoy:
                    fechas_vencidas += 1

    if fechas_vencidas > 0:
        fiados_con_mora = 1

    limite = float(cliente.get("limite_credito", 0))
    credito_usado = float(cliente.get("credito_usado", 0))
    moroso = cliente.get("moroso", False)
    telefono = cliente.get("telefono", "")

    score = 50

    if moroso:
        score = 0
        return {
            "score": 0,
            "detalle": _detalle_score(0, total_fiados, fiados_pagados, fiados_con_mora,
                                      fechas_vencidas, limite, credito_usado, moroso, telefono),
            "estado": "Rechazado",
            "razon": "El cliente está marcado como moroso.",
        }

    if fiados_con_mora == 0:
        score += 15
    if total_fiados > 0 and fiados_pagados / total_fiados > 0.8:
        score += 10
    if limite > 0 and credito_usado / limite < 0.5:
        score += 10
    if fiados_pagados > 0:
        score += 10
    if telefono:
        score += 5

    if fechas_vencidas > 0:
        score -= 20
    if limite > 0 and credito_usado / limite > 0.8:
        score -= 15
    if total_fiados == 0:
        score -= 10

    score = max(0, min(100, score))

    if score >= UMBRAL_APROBADO:
        estado = "Aprobado"
        razon = "Buen historial de pagos."
    elif score >= UMBRAL_REVISION:
        estado = "Pendiente"
        razon = "Historial regular. Requiere revisión manual."
    else:
        estado = "Rechazado"
        razon = "Historial de pago insuficiente o deuda significativa."

    return {
        "score": score,
        "detalle": _detalle_score(score, total_fiados, fiados_pagados, fiados_con_mora,
                                  fechas_vencidas, limite, credito_usado, moroso, telefono),
        "estado": estado,
        "razon": razon,
        "total_fiados": total_fiados,
        "fiados_pagados": fiados_pagados,
        "fiados_con_mora": fiados_con_mora,
        "cuotas_vencidas": fechas_vencidas,
        "saldo_total": round(saldo_total, 2),
    }


def _detalle_score(score, total, pagados, mora, vencidas, limite, usado, moroso, tel):
    detalles = []

    if moroso:
        detalles.append(("Rechazado", "Cliente marcado como moroso", -score if score > 0 else 0))
        return detalles

    if mora == 0 and total > 0:
        detalles.append(("Positivo", "Sin fechas vencidas actualmente", "+15"))
    elif mora > 0:
        detalles.append(("Negativo", f"{vencidas} fecha(s) vencida(s)", "-20"))

    if total > 0 and pagados / total > 0.8:
        detalles.append(("Positivo", f"{pagados}/{total} fiados pagados (>80%)", "+10"))
    elif total > 0:
        detalles.append(("Neutral", f"{pagados}/{total} fiados pagados", "0"))

    if limite > 0 and usado / limite < 0.5:
        detalles.append(("Positivo", "Crédito disponible (>50% libre)", "+10"))
    elif limite > 0 and usado / limite > 0.8:
        detalles.append(("Negativo", "Crédito casi agotado (>80% usado)", "-15"))

    if pagados > 0:
        detalles.append(("Positivo", "Tiene fiados anteriores pagados", "+10"))

    if tel:
        detalles.append(("Positivo", "Teléfono registrado", "+5"))

    if total == 0:
        detalles.append(("Negativo", "Sin historial (primer fiado)", "-10"))

    return detalles


def puede_crear_fiado(cliente, monto_nuevo, cliente_id=None):
    cid = cliente_id or cliente.get("id")
    limite = float(cliente.get("limite_credito", 0))
    credito_usado = float(cliente.get("credito_usado", 0))
    moroso = cliente.get("moroso", False)

    if moroso:
        return False, "El cliente está marcado como moroso y no puede solicitar nuevos fiados."

    if limite > 0 and (credito_usado + monto_nuevo) > limite:
        return False, (
            f"El fiado de ${monto_nuevo:,.2f} supera el límite de crédito del cliente "
            f"(Límite: ${limite:,.2f} · Usado: ${credito_usado:,.2f} · "
            f"Disponible: ${max(0, limite - credito_usado):,.2f})."
        )

    return True, "Crédito disponible."


def actualizar_credito_cliente(cliente_id, fiados=None):
    if fiados is None:
        fiados = fiados_store.load_fiados()

    total_deuda = 0.0
    for f in fiados.values():
        if str(f.get("cliente", {}).get("id", "")) != str(cliente_id):
            continue
        if f.get("estado") != "Pagado":
            total_deuda += float(f.get("saldo_pendiente", 0))

    clientes = clientes_store.load_clientes()
    cid = str(cliente_id)
    if cid in clientes:
        clientes[cid]["credito_usado"] = round(total_deuda, 2)
        clientes_store.save_clientes(clientes)

    return round(total_deuda, 2)


def calcular_morosidad(cliente_id, fiados=None):
    if fiados is None:
        fiados = fiados_store.load_fiados()

    hoy = date.today()
    for f in fiados.values():
        if str(f.get("cliente", {}).get("id", "")) != str(cliente_id):
            continue
        if f.get("estado") == "Pagado":
            continue
        for fr in f.get("fechas_ruta", []):
            if fr.get("cobrado"):
                continue
            fecha_limite = _parsear_fecha(fr.get("fecha"))
            if fecha_limite and (hoy - fecha_limite).days > 30:
                return True
    return False


def actualizar_estado_moroso(cliente_id, fiados=None):
    moroso = calcular_morosidad(cliente_id, fiados)
    clientes = clientes_store.load_clientes()
    cid = str(cliente_id)
    if cid in clientes:
        clientes[cid]["moroso"] = moroso
        clientes_store.save_clientes(clientes)
    return moroso
