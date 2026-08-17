#!/usr/bin/env python3
"""
Importador masivo de fiados manuales al sistema.
Lee data/importar_fiados.json y crea cliente + factura + fiado + abonos para cada registro.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from routes import clientes_store, facturas_store, fiados_store
from utils import ahora

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
IMPORT_FILE = os.path.join(DATA_DIR, "importar_fiados.json")


def _buscar_cliente_por_nombre(nombre):
    clientes = clientes_store.load_clientes()
    nombre_lower = nombre.strip().lower()
    for cid, c in clientes.items():
        if c.get("nombre", "").strip().lower() == nombre_lower:
            return cid, c
    return None, None


def importar():
    if not os.path.exists(IMPORT_FILE):
        print(f"ERROR: No se encontró {IMPORT_FILE}")
        return

    with open(IMPORT_FILE, "r", encoding="utf-8") as f:
        registros = json.load(f)

    print(f"Se encontraron {len(registros)} registros para importar.\n")

    clientes_creados = 0
    fiados_creados = 0
    abonos_registrados = 0
    errores = []

    for i, reg in enumerate(registros, 1):
        nombre = reg.get("cliente_nombre", "").strip()
        if not nombre or nombre == "NOMBRE DEL CLIENTE":
            print(f"[{i}] SALTADO - nombre vacío o es el placeholder")
            continue

        try:
            total = float(reg.get("total", 0))
            if total <= 0:
                errores.append(f"[{i}] {nombre}: total inválido ({total})")
                print(f"[{i}] ERROR - {nombre}: total inválido")
                continue

            senia = float(reg.get("senia", 0))
            if senia < 0:
                senia = 0

            n_cuotas = int(reg.get("n_cuotas", 6))
            if n_cuotas < 1:
                n_cuotas = 6

            frecuencia = reg.get("frecuencia", "Quincenal")
            if frecuencia not in fiados_store.FRECUENCIAS:
                frecuencia = "Quincenal"

            fecha_venta = reg.get("fecha_venta", ahora().strftime("%Y-%m-%d"))
            articulo = reg.get("articulo", "")
            vendedor = reg.get("vendedor", "")
            ciudad = reg.get("ciudad", "")

            cliente_id, cliente_existente = _buscar_cliente_por_nombre(nombre)
            if not cliente_existente:
                ok, cid = clientes_store.crear_cliente(
                    nombre=nombre,
                    documento=reg.get("cliente_documento", ""),
                    telefono=reg.get("cliente_telefono", ""),
                    direccion=reg.get("cliente_direccion", ""),
                    limite_credito=total,
                )
                if not ok:
                    errores.append(f"[{i}] {nombre}: no se pudo crear el cliente")
                    print(f"[{i}] ERROR - no se pudo crear cliente {nombre}")
                    continue
                cliente_id = cid
                clientes_creados += 1
                print(f"[{i}] Cliente creado: {nombre} (ID: {cid})")
            else:
                print(f"[{i}] Cliente ya existe: {nombre} (ID: {cliente_id})")

            cliente_data = clientes_store.buscar_cliente(cliente_id)

            items = []
            if articulo:
                items.append({
                    "descripcion": articulo,
                    "cantidad": 1,
                    "precio": total,
                })

            numero_factura = facturas_store.crear_factura(
                tipo="Factura",
                fecha=fecha_venta,
                cliente=cliente_data,
                items=items,
                estado="Pagada",
                observacion=f"Importado manual - {ciudad}" if ciudad else "Importado manual",
                vendedor=vendedor,
                forma_pago="Fiado",
            )
            print(f"   Factura creada: {numero_factura}")

            factura = facturas_store.load_facturas().get(numero_factura)
            if not factura:
                errores.append(f"[{i}] {nombre}: no se pudo recuperar la factura creada")
                print(f"   ERROR - no se pudo recuperar factura {numero_factura}")
                continue

            numero_fiado = fiados_store.crear_fiado(
                fecha=fecha_venta,
                factura=factura,
                n_cuotas=n_cuotas,
                frecuencia=frecuencia,
                fecha_inicio=fecha_venta,
                vendedor=vendedor,
                aprobacion_estado="Aprobado",
                aprobacion_score=0,
                aprobacion_razon="Importado de registro manual",
            )
            fiados_creados += 1
            print(f"   Fiado creado: {numero_fiado}")

            if senia > 0:
                ok, msg = fiados_store.registrar_abono(
                    numero_fiado, fecha_venta, senia, vendedor or "Sistema"
                )
                if ok:
                    abonos_registrados += 1
                    print(f"   Seña registrada: ${senia:,.0f}")
                else:
                    print(f"   WARNING seña: {msg}")

            abonos = reg.get("abonos", [])
            for abono in abonos:
                fecha_abono = abono.get("fecha", "")
                monto_abono = float(abono.get("monto", 0))
                if monto_abono <= 0 or not fecha_abono:
                    continue
                ok, msg = fiados_store.registrar_abono(
                    numero_fiado, fecha_abono, monto_abono, vendedor or "Sistema"
                )
                if ok:
                    abonos_registrados += 1
                    print(f"   Abono: ${monto_abono:,.0f} el {fecha_abono}")
                else:
                    print(f"   WARNING abono: {msg}")

            fiado_final = fiados_store.load_fiados().get(numero_fiado)
            if fiado_final:
                saldo = fiado_final.get("saldo_pendiente", 0)
                print(f"   Saldo final: ${saldo:,.0f}")
            print()

        except Exception as e:
            errores.append(f"[{i}] {nombre}: {str(e)}")
            print(f"[{i}] ERROR inesperado - {nombre}: {e}\n")

    print("=" * 50)
    print(f"RESUMEN:")
    print(f"  Clientes creados:  {clientes_creados}")
    print(f"  Fiados creados:    {fiados_creados}")
    print(f"  Abonos registrados:{abonos_registrados}")
    if errores:
        print(f"  Errores:           {len(errores)}")
        for e in errores:
            print(f"    - {e}")
    print("=" * 50)


if __name__ == "__main__":
    importar()
