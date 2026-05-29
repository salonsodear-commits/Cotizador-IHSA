#!/usr/bin/env python3
"""
xlsx_to_json.py — Convierte los Excel de /source en JSON para /data.

Uso:
    python scripts/xlsx_to_json.py [--source SOURCE] [--out OUT] [--only KEY]

Filosofía:
    - El nombre de la hoja y de las columnas son el contrato. Si alguien
      renombra una columna, el script FALLA ruidosamente.
    - Determinístico: mismo Excel → mismo JSON byte-a-byte.
    - 14 mappings: 11 originales + 3 nuevos (Dashboard Moviles, Dashboard
      Trailers, Tabla Estandarizada de Mantenimiento).
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════════
# Helpers de casting
# ═══════════════════════════════════════════════════════════════════════════
def _num(v, default=0):
    if pd.isna(v) or v == "":
        return default
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def _int(v, default=0):
    if pd.isna(v) or v == "":
        return default
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return default


def _str(v, default=""):
    if pd.isna(v) or v is None:
        return default
    return str(v).strip()


# ═══════════════════════════════════════════════════════════════════════════
# Transformadores
# ═══════════════════════════════════════════════════════════════════════════
def _transform_sueldos(rows):
    out = {}
    for r in rows:
        prov = _str(r["provincia"])
        if prov == "Neuquén":
            prov = "Neuquen"
        out.setdefault(prov, {}).setdefault(_str(r["convenio"]), {}).setdefault(
            _str(r["categoria"]), {}
        )[_str(r["puesto"]).lower()] = {
            "b": _num(r["sueldo_bruto"]),
            "c": _num(r["costo_total_cia"]),
        }
    return out


def _transform_iibb(rows):
    return {_str(r["provincia"]): _num(r["iibb_alicuota"]) for r in rows}


def _transform_defaults(rows):
    out = {}
    for r in rows:
        key = _str(r["clave"])
        raw_val = r["valor_json"]
        if pd.isna(raw_val) or raw_val == "":
            continue
        try:
            out[key] = json.loads(raw_val)
        except json.JSONDecodeError as e:
            raise ValueError(f"defaults clave '{key}': {e}")
    return out


# ─── Casts fila por fila ───────────────────────────────────────────────────
def _cast_row_moviles(r):
    return {
        "ec": _str(r["eecc"]),
        "tp": _str(r["tipo"]),
        "cl": _str(r["clasificacion"]),
        "de": _str(r["descripcion"]),
        "in": _int(r["incluir"]),
        "vu": _int(r["vida_util_meses"]),
        "qt": _int(r["qty"]),
        "vm": round(_num(r["valor_mensual"]), 2),
    }


def _cast_row_trailers(r):
    return {
        "cat": _str(r["categoria"]),
        "i": _str(r["item"]),
        "neg": _str(r["negocio"]),
        "vc": round(_num(r["valor_compra"]), 2),
        "m": _int(r["meses_amortiz"]),
        "vm": round(_num(r["valor_mensual"]), 2),
    }


def _cast_row_uniformes(r):
    return {
        "n": _str(r["negocio"]),
        "e": _int(r["entregas_anuales"]),
        "i": _str(r["item"]),
        "u": round(_num(r["costo_unit"]), 2),
        "ta": round(_num(r["total_anual"]), 2),
        "tm": round(_num(r["total_mensual"]), 2),
    }


def _cast_row_comunicacion(r):
    return {
        "i": _str(r["item"]),
        "q": _int(r["qty"]),
        "v": round(_num(r["valor"]), 2),
        "a": _int(r["amortiz_meses"]),
        "m": round(_num(r["mensual"]), 2),
    }


def _cast_row_consultorio(r):
    return {
        "n": _str(r["negocio"]),
        "t": _str(r["tipo"]),
        "i": _str(r["item"]),
        "q": _int(r["qty"]),
        "cu": round(_num(r["costo_unit"]), 2),
        "ct": round(_num(r["costo_total"]), 2),
        "qm": _int(r["meses_amortiz"]),
        "am": round(_num(r["amortiz_mensual"]), 2),
    }


def _cast_row_estructura(r):
    return {
        "pr": _str(r["provincia"]),
        "co": _str(r["concepto"]),
        "tp": _str(r["tipo"]),
        "at": _str(r["atributo"]),
        "v": round(_num(r["valor_anual"]), 2),
    }


def _cast_row_logistica(r):
    return {"p": _str(r["parametro"]), "v": _num(r["valor"])}


def _cast_row_medicacion(r):
    return {
        "id": _str(r["id"]),
        "n": _str(r["master"]),
        "cl": _str(r["clase"]),
        "nombre": _str(r["nombre"]),
        "cat": _str(r["categoria"]),
        "unidad": _str(r["unidad"]),
        "pu": round(_num(r["precio_unit"]), 2),
    }


# ─── NUEVOS: Dashboard Móviles, Dashboard Trailers, Tabla Estandarizada ────
def _cast_row_moviles_dashboard(r):
    """
    Hoja 'Datos' del Dashboard_Moviles_OC.
    Headers: Región, Vertical, N° Interno, Dominio, Tipo, Modelo, Año,
             Habilitación, Cliente, Área, Carácter, Provincia, Estado,
             Clasificación, Flota
    Mapeamos a campos cortos y dejamos 'disponible' calculado:
    Estado 'Back Up' → disponible=1, resto → 0.
    """
    estado = _str(r["Estado"])
    return {
        "id":      _str(r["N° Interno"]) or _str(r["Dominio"]),
        "region":  _str(r["Región"]),
        "vert":    _str(r["Vertical"]),
        "interno": _str(r["N° Interno"]),
        "dom":     _str(r["Dominio"]),
        "tipo":    _str(r["Tipo"]),
        "modelo":  _str(r["Modelo"]),
        "anio":    _int(r["Año"]),
        "cliente": _str(r["Cliente"]),
        "prov":    _str(r["Provincia"]),
        "estado":  estado,
        "clasif":  _str(r["Clasificación"]),
        "flota":   _str(r["Flota"]),
        "disp":    1 if estado == "Back Up" else 0,
    }


def _cast_row_trailers_dashboard(r):
    """
    Hoja 'Trailers (MODELO)' del Dashboard_Moviles_OC.
    Headers: Dominio, Tipo, Modelo, Antiguedad_Anios, Costo_Mensual, Disponible
    """
    disp_raw = _str(r["Disponible"]).lower()
    return {
        "id":      _str(r["Dominio"]),
        "tipo":    _str(r["Tipo"]),
        "modelo":  _str(r["Modelo"]),
        "antig":   _int(r["Antiguedad_Anios"]),
        "cm":      round(_num(r["Costo_Mensual"]), 2),
        "disp":    1 if disp_raw == "si" else 0,
    }


def _cast_row_mantenimiento(r):
    """
    Hoja 'Tabla Estandarizada' del Mantenimiento - Estandarizada.
    Headers: id, hoja_origen, seccion, categoria, subcategoria, item,
             proveedor, qty, valor_unitario, valor_compra_total,
             inversion_inicial, meses_amortizacion, valor_mensual,
             tipo_registro, observaciones
    Solo se exportan filas con tipo_registro = 'COSTO'.
    """
    return {
        "id":     _str(r["id"]),
        "origen": _str(r["hoja_origen"]),       # Ambulancias / Trailers / Logistica
        "secc":   _str(r["seccion"]),
        "cat":    _str(r["categoria"]),         # Móvil / Trailer
        "subcat": _str(r["subcategoria"]),      # UTIM / Infraestructura / Logística
        "item":   _str(r["item"]),
        "qty":    _num(r["qty"]),
        "vu":     _num(r["valor_unitario"]),
        "vct":    _num(r["valor_compra_total"]),
        "ii":     _num(r["inversion_inicial"]),
        "ma":     _num(r["meses_amortizacion"]),
        "vm":     round(_num(r["valor_mensual"]), 2),
        "tipo":   _str(r["tipo_registro"]),
        "obs":    _str(r["observaciones"]),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Mappings declarativos
# ═══════════════════════════════════════════════════════════════════════════
MAPPINGS = {
    "sueldos": {
        "xlsx": "sueldos.xlsx", "json": "sueldos.json", "sheet": "Sueldos",
        "required": ["provincia", "convenio", "categoria", "puesto", "sueldo_bruto", "costo_total_cia"],
        "shape": "dict-custom", "transform": _transform_sueldos,
    },
    "iibb": {
        "xlsx": "iibb.xlsx", "json": "iibb.json", "sheet": "IIBB",
        "required": ["provincia", "iibb_alicuota"],
        "shape": "dict-custom", "transform": _transform_iibb,
    },
    "moviles": {
        "xlsx": "moviles.xlsx", "json": "moviles.json", "sheet": "Moviles",
        "required": ["eecc", "tipo", "clasificacion", "descripcion", "incluir", "vida_util_meses", "qty", "valor_mensual"],
        "shape": "array", "cast_row": _cast_row_moviles,
    },
    "trailers": {
        "xlsx": "trailers.xlsx", "json": "trailers.json", "sheet": "Trailers",
        "required": ["categoria", "item", "negocio", "valor_compra", "meses_amortiz", "valor_mensual"],
        "shape": "array", "cast_row": _cast_row_trailers,
    },
    "uniformes": {
        "xlsx": "uniformes.xlsx", "json": "uniformes.json", "sheet": "Uniformes",
        "required": ["negocio", "entregas_anuales", "item", "costo_unit", "total_anual", "total_mensual"],
        "shape": "array", "cast_row": _cast_row_uniformes,
    },
    "comunicacion": {
        "xlsx": "comunicacion.xlsx", "json": "comunicacion.json", "sheet": "Comunicacion",
        "required": ["item", "qty", "valor", "amortiz_meses", "mensual"],
        "shape": "array", "cast_row": _cast_row_comunicacion,
    },
    "consultorio": {
        "xlsx": "consultorio.xlsx", "json": "consultorio.json", "sheet": "Consultorio",
        "required": ["negocio", "tipo", "item", "qty", "costo_unit", "costo_total", "meses_amortiz", "amortiz_mensual"],
        "shape": "array", "cast_row": _cast_row_consultorio,
    },
    "estructura": {
        "xlsx": "estructura.xlsx", "json": "estructura.json", "sheet": "Estructura",
        "required": ["provincia", "concepto", "tipo", "atributo", "valor_anual"],
        "shape": "array", "cast_row": _cast_row_estructura,
    },
    "logistica": {
        "xlsx": "logistica.xlsx", "json": "logistica.json", "sheet": "Logistica",
        "required": ["parametro", "valor"],
        "shape": "array", "cast_row": _cast_row_logistica,
    },
    "medicacion": {
        "xlsx": "medicacion.xlsx", "json": "medicacion.json", "sheet": "Medicacion",
        "required": ["id", "master", "clase", "nombre", "categoria", "unidad", "precio_unit"],
        "shape": "array", "cast_row": _cast_row_medicacion,
    },
    "defaults": {
        "xlsx": "defaults.xlsx", "json": "defaults.json", "sheet": "Defaults",
        "required": ["clave", "valor_json"],
        "shape": "dict-custom", "transform": _transform_defaults,
    },

    # ─── NUEVOS ────────────────────────────────────────────────────────────
    "moviles_dashboard": {
        "xlsx": "Dashboard_Moviles_OC.xlsx", "json": "moviles_dashboard.json",
        "sheet": "Datos", "header_row": 2,
        "required": ["Vertical", "Dominio", "Tipo", "Estado"],
        "shape": "array", "cast_row": _cast_row_moviles_dashboard,
    },
    "trailers_dashboard": {
        "xlsx": "Dashboard_Moviles_OC.xlsx", "json": "trailers_dashboard.json",
        "sheet": "Trailers (MODELO)", "header_row": 1,
        "required": ["Dominio", "Tipo", "Modelo", "Antiguedad_Anios", "Costo_Mensual", "Disponible"],
        "shape": "array", "cast_row": _cast_row_trailers_dashboard,
    },
    "mantenimiento": {
        "xlsx": "Mantenimiento_-_Estandarizada.xlsx", "json": "costos_mantenimiento.json",
        "sheet": "Tabla Estandarizada", "header_row": 1,
        "required": ["id", "hoja_origen", "item", "tipo_registro"],
        "shape": "array", "cast_row": _cast_row_mantenimiento,
        "filter_fn": lambda r: _str(r.get("tipo_registro")) == "COSTO",
    },
}


# ═══════════════════════════════════════════════════════════════════════════
# Procesador
# ═══════════════════════════════════════════════════════════════════════════
class ConversionError(Exception):
    pass


def process_file(key, spec, source_dir, out_dir):
    xlsx_path = source_dir / spec["xlsx"]
    if not xlsx_path.exists():
        raise ConversionError(f"No existe: {xlsx_path}")

    header_row = spec.get("header_row", 1)  # 1-indexed; pandas usa 0-indexed
    try:
        df = pd.read_excel(
            xlsx_path, sheet_name=spec["sheet"],
            header=header_row - 1,  # convertir a 0-indexed
            dtype=object,
        )
    except ValueError as e:
        raise ConversionError(f"{spec['xlsx']}: hoja '{spec['sheet']}' no encontrada. {e}")

    df.columns = [str(c).strip() for c in df.columns]

    missing = [c for c in spec["required"] if c not in df.columns]
    if missing:
        raise ConversionError(
            f"{spec['xlsx']} hoja '{spec['sheet']}': faltan columnas {missing}. "
            f"Encontradas: {list(df.columns)}"
        )

    df = df.dropna(how="all")
    rows_raw = df.to_dict(orient="records")

    # Filtro opcional
    filter_fn = spec.get("filter_fn")
    if filter_fn:
        rows_raw = [r for r in rows_raw if filter_fn(r)]

    # Validar required no-nulos (post-filtro)
    for col in spec["required"]:
        for i, r in enumerate(rows_raw):
            if pd.isna(r.get(col)) or r.get(col) == "":
                # Excepción: 'N° Interno' puede estar vacío si hay Dominio
                if col == "N° Interno" and r.get("Dominio"):
                    continue
                raise ConversionError(
                    f"{spec['xlsx']} hoja '{spec['sheet']}': fila {i+1} columna '{col}' vacía"
                )

    shape = spec["shape"]
    if shape == "array":
        result = [spec["cast_row"](r) for r in rows_raw]
        row_count = len(result)
    elif shape == "dict-custom":
        result = spec["transform"](rows_raw)
        row_count = len(rows_raw)
    else:
        raise ConversionError(f"shape desconocido: {shape}")

    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / spec["json"]
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    return row_count, f"→ {spec['json']} ({row_count} filas)"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="source")
    parser.add_argument("--out", default="data")
    parser.add_argument("--only")
    args = parser.parse_args()

    source_dir = Path(args.source)
    out_dir = Path(args.out)

    if not source_dir.is_dir():
        print(f"ERROR: directorio source no existe: {source_dir}", file=sys.stderr)
        return 2

    keys = [args.only] if args.only else list(MAPPINGS.keys())
    if args.only and args.only not in MAPPINGS:
        print(f"ERROR: clave '{args.only}' desconocida.", file=sys.stderr)
        return 2

    print(f"═══ xlsx_to_json: {len(keys)} archivo(s) ═══")
    print(f"source: {source_dir.resolve()}")
    print(f"out:    {out_dir.resolve()}\n")

    errors, total_rows = [], 0
    for key in keys:
        spec = MAPPINGS[key]
        try:
            count, msg = process_file(key, spec, source_dir, out_dir)
            print(f"  ✔ {key:20s} {msg}")
            total_rows += count
        except ConversionError as e:
            print(f"  ✘ {key:20s} ERROR: {e}")
            errors.append((key, str(e)))
        except Exception as e:
            print(f"  ✘ {key:20s} EXCEPTION: {type(e).__name__}: {e}")
            errors.append((key, f"{type(e).__name__}: {e}"))

    print(f"\n═══ Resumen ═══")
    print(f"  OK:      {len(keys) - len(errors)}/{len(keys)}")
    print(f"  Filas:   {total_rows}")
    print(f"  Errores: {len(errors)}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
