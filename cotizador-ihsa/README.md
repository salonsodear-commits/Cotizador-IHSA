# Cotizador-IHSA · Repositorio de datos

Fuente única de datos del cotizador de Operaciones Complejas. Los analistas editan archivos en `/source`, un GitHub Action los convierte a JSON en `/data`, y el cotizador los consume vía Cloudflare Worker.

## 📁 Estructura

```
.
├── source/                              # ✏️ editado por humanos
│   ├── Dashboard_Moviles_OC.xlsx        # móviles + trailers (disponibilidad real)
│   ├── Mantenimiento_-_Estandarizada.xlsx  # costos EECC (hoja "Tabla Estandarizada")
│   ├── sueldos.xlsx, iibb.xlsx, ...     # maestros base (11 archivos)
│   └── ZREAL/
│       └── fact_mes_vertical_categoria.json  # base de gastos reales SAP
├── data/                                # 🤖 generado por el Action (NO editar a mano)
│   ├── moviles_dashboard.json           # 109 móviles, disp=1 si Estado="Back Up"
│   ├── trailers_dashboard.json          # 10 trailers, disp=1 si Disponible="Si"
│   ├── costos_mantenimiento.json        # 121 costos (tipo_registro="COSTO")
│   ├── gastos_estructura_zreal.json     # gastos por vertical/mes (prorrateo)
│   ├── categorias_estructura.json       # qué categorías son "estructura" (editable)
│   └── ...                              # 11 maestros base
├── scripts/
│   ├── xlsx_to_json.py                  # convierte source/*.xlsx → data/*.json
│   └── zreal_to_json.py                 # agrega ZREAL → gastos_estructura_zreal.json
├── worker.js                            # Cloudflare Worker (proxy seguro)
└── .github/workflows/xlsx-to-json.yml   # Action que corre ambos scripts
```

## 🚦 Flujo

1. Editás un Excel en `source/` o el JSON del ZREAL.
2. Commit + push a `main`.
3. El Action corre `xlsx_to_json.py` + `zreal_to_json.py`, regenera `data/`, commitea.
4. El cotizador toma los nuevos datos en la próxima carga (cache 10 min, botón ↻ fuerza refresh).

> ⚠️ Nunca edites `data/` a mano: se sobrescribe en cada push.

## ⚠️ Contratos críticos (no romper)

### Dashboard_Moviles_OC.xlsx
- Hoja **`Datos`**, headers en **fila 2**. Columnas usadas: `Región, Vertical, N° Interno, Dominio, Tipo, Modelo, Año, Cliente, Provincia, Estado, Clasificación, Flota`.
  - Disponibilidad: `Estado = "Back Up"` → DISPONIBLE. `Asignado` / `En Reparación` → NO disponible.
- Hoja **`Trailers (MODELO)`**, headers en **fila 1**. Columnas: `Dominio, Tipo, Modelo, Antiguedad_Anios, Costo_Mensual, Disponible`.
  - Disponibilidad: `Disponible = "Si"`.

### Mantenimiento_-_Estandarizada.xlsx
- Hoja **`Tabla Estandarizada`**, headers en **fila 1**. Columnas: `id, hoja_origen, seccion, categoria, subcategoria, item, proveedor, qty, valor_unitario, valor_compra_total, inversion_inicial, meses_amortizacion, valor_mensual, tipo_registro, observaciones`.
  - Solo se exportan filas con `tipo_registro = "COSTO"`.
  - `hoja_origen`: `Ambulancias` / `Trailers` / `Logistica` → define a qué wizard van los costos EECC.

### ZREAL/fact_mes_vertical_categoria.json
- Array de `{PERIODO_AAAAMM, VERTICAL, CATEGORIA_GERENCIAL, monto, docs}`.
- `VERTICAL`: `PETROLEO` / `MINERIA` / `OTRAS OPERACIONES DEDICADAS`.

### categorias_estructura.json (editable por Control de Gestión)
Define qué categorías gerenciales cuentan como "estructura" en el prorrateo. Editá el array `categorias_estructura` y commiteá. El resto se considera operativo.

## 📐 Fórmula de Gastos de Estructura

```
% = costo_total_cotización(sin estructura) ÷ gasto_total_vertical_mes (ZREAL)
gasto_imputado = % × gasto_estructura_vertical_mes (ZREAL)
```

La vertical se deriva del negocio configurado en la cotización. El último mes ZREAL disponible se usa automáticamente.

## 🔌 Integración con el cotizador

`WORKER_CONFIG.baseUrl` en el `.jsx` apunta al Worker. El Worker lee de este repo con un PAT fine-grained (Contents:Read). Ver `worker.js` y la guía de deploy.

## 🧪 Probar localmente

```bash
pip install pandas openpyxl
python scripts/xlsx_to_json.py      # Excel → JSON
python scripts/zreal_to_json.py     # ZREAL → JSON
```
