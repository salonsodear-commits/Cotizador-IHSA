#!/usr/bin/env python3
"""
zreal_to_json.py — Procesa la base ZREAL (fact_mes_vertical_categoria.json)
y genera los archivos que consume el cotizador para la pestaña
"Gastos de Estructura".

Uso:
    python scripts/zreal_to_json.py [--source SOURCE_DIR] [--out OUT_DIR]

Inputs (en source/ZREAL/):
    - fact_mes_vertical_categoria.json
        Array de {PERIODO_AAAAMM, VERTICAL, CATEGORIA_GERENCIAL, monto, docs}.

Outputs (en data/):
    - gastos_estructura_zreal.json
        {
          "ultimo_mes": "202604",
          "version": "<sha del fact>",
          "verticales": {
            "PETROLEO": {
              "categorias": {"ALQUILERES": 12345, ...},
              "total_mes":               198045221,
              "total_estructura_mes":     23456789,
              "promedio_12m":            213450000,
              "promedio_estructura_12m":  25000000
            },
            ...
          }
        }

    - categorias_estructura.json
        Lista editable de qué categorías cuentan como "estructura"
        para el cálculo. Si el archivo existe en source/ no se sobrescribe
        (es el contrato editable por Control de Gestión).
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path


# ═══════════════════════════════════════════════════════════════════════════
# DEFAULTS — clasificación inicial de qué categorías son "estructura"
# Si Control de Gestión edita el JSON, gana lo editado.
# ═══════════════════════════════════════════════════════════════════════════
CATEGORIAS_ESTRUCTURA_DEFAULT = {
    "categorias_estructura": [
        "ALQUILERES",
        "LIMPIEZA_Y_VIGILANCIA",
        "MANTENIMIENTO",
        "SERVICIOS_PUBLICOS",
        "INSUMOS_OFICINA",
        "SEGUROS",
        "TECNOLOGIA_IT",
        "IMPUESTOS_TASAS",
        "HONORARIOS_SERV_CONTR",
        "PROMOCION_PUBLICIDAD",
    ],
    "categorias_operativas_no_estructura": [
        "RRHH_BENEFICIOS",
        "UNIFORMES_INSUMOS",
        "ALIMENTACION",
        "VIATICOS_HOSPEDAJE",
        "TRANSPORTE_LOGISTICA",
        "RODADOS",
        "INCOBRABLES",
        "FINANCIEROS",
    ],
    "nota": (
        "Solo las categorias_estructura suman al gasto imputable. "
        "Las operativas se incluyen en el denominador (total vertical) pero "
        "no en el numerador del gasto estructural ZREAL. Editable por CG."
    ),
}


def _file_sha(path: Path, length: int = 8) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()[:length]


def procesar(source_zreal_dir: Path, out_dir: Path) -> int:
    fact_path = source_zreal_dir / "fact_mes_vertical_categoria.json"
    if not fact_path.exists():
        print(f"ERROR: no existe {fact_path}", file=sys.stderr)
        return 1

    print(f"Leyendo {fact_path.name}...")
    with open(fact_path, "r", encoding="utf-8") as f:
        fact = json.load(f)
    print(f"  {len(fact)} registros (mes × vertical × categoría)")

    # 1. Identificar último mes disponible
    periodos = sorted(set(r["PERIODO_AAAAMM"] for r in fact))
    if not periodos:
        print("ERROR: fact vacío", file=sys.stderr)
        return 1
    ultimo_mes = periodos[-1]
    print(f"  Último mes disponible: {ultimo_mes}")
    print(f"  Cobertura total: {periodos[0]} → {periodos[-1]} ({len(periodos)} meses)")

    # 2. Cargar (o crear) clasificación de categorías
    cat_estr_path = out_dir / "categorias_estructura.json"
    if cat_estr_path.exists():
        with open(cat_estr_path, "r", encoding="utf-8") as f:
            cat_estr_cfg = json.load(f)
        print(f"  Usando categorias_estructura.json existente ({len(cat_estr_cfg['categorias_estructura'])} categorías estructurales)")
    else:
        cat_estr_cfg = CATEGORIAS_ESTRUCTURA_DEFAULT
        out_dir.mkdir(parents=True, exist_ok=True)
        with open(cat_estr_path, "w", encoding="utf-8") as f:
            json.dump(cat_estr_cfg, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        print(f"  Generado categorias_estructura.json (default)")

    categorias_estructura = set(cat_estr_cfg["categorias_estructura"])

    # 3. Agrupar por VERTICAL × CATEGORÍA × MES
    # estructura: por_vertical[vertical][periodo][categoria] = monto
    por_vertical: dict = defaultdict(lambda: defaultdict(dict))
    for r in fact:
        v = r["VERTICAL"]
        p = r["PERIODO_AAAAMM"]
        c = r["CATEGORIA_GERENCIAL"]
        m = float(r.get("monto", 0))
        por_vertical[v][p][c] = m

    # 4. Calcular últimos 12 meses (rolling) por vertical
    # ultimos_12m = los 12 períodos más recientes presentes en cada vertical
    out: dict = {
        "ultimo_mes": ultimo_mes,
        "version": _file_sha(fact_path),
        "verticales": {},
    }

    for vertical in sorted(por_vertical.keys()):
        periodos_v = sorted(por_vertical[vertical].keys())
        if not periodos_v:
            continue

        # Datos del último mes
        cats_ultimo = por_vertical[vertical][ultimo_mes] if ultimo_mes in por_vertical[vertical] else {}
        total_mes = sum(cats_ultimo.values())
        total_estructura_mes = sum(
            v for c, v in cats_ultimo.items() if c in categorias_estructura
        )

        # Promedio últimos 12 meses (de los presentes; si hay menos, promedia los que hay)
        ultimos_12 = periodos_v[-12:]
        if ultimos_12:
            sum_total_12 = sum(
                sum(por_vertical[vertical][p].values()) for p in ultimos_12
            )
            sum_estr_12 = sum(
                sum(v for c, v in por_vertical[vertical][p].items() if c in categorias_estructura)
                for p in ultimos_12
            )
            promedio_12m = sum_total_12 / len(ultimos_12)
            promedio_estructura_12m = sum_estr_12 / len(ultimos_12)
        else:
            promedio_12m = 0
            promedio_estructura_12m = 0

        out["verticales"][vertical] = {
            "categorias": {c: round(v, 2) for c, v in sorted(cats_ultimo.items())},
            "total_mes": round(total_mes, 2),
            "total_estructura_mes": round(total_estructura_mes, 2),
            "promedio_12m": round(promedio_12m, 2),
            "promedio_estructura_12m": round(promedio_estructura_12m, 2),
            "meses_disponibles": len(periodos_v),
        }

    # 5. Escribir output
    out_path = out_dir / "gastos_estructura_zreal.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    print(f"\n✔ Generado {out_path.name}:")
    for v, data in out["verticales"].items():
        print(f"  {v:30s} total mes: ${data['total_mes']:>15,.0f}   estr mes: ${data['total_estructura_mes']:>15,.0f}")
    print()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="source/ZREAL")
    parser.add_argument("--out", default="data")
    args = parser.parse_args()
    return procesar(Path(args.source), Path(args.out))


if __name__ == "__main__":
    sys.exit(main())
