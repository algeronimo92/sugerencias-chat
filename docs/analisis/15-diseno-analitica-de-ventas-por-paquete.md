# 15 · Diseño: analítica de ventas por paquete (pestaña "Ventas" del dashboard)

Fecha: 2026-11-09 · Estado: **propuesta, sin código** · Origen: pedido de ver cuántos paquetes se venden; auditoría 11, hallazgo N5 ("métricas de operación, no de ROI").

Maqueta interactiva con datos de ejemplo: <https://claude.ai/artifact/8ADM2eLA5DE4Cmopy6ShYA> (privada; compartirla desde el menú de la página).

## 1. Qué se guarda hoy

Sí se guarda. Cada compra es una fila de `lead_sales` (`backend/app/db/models/leads.py`): lead, servicio, paquete, nombre y sesiones del paquete **copiados al momento de vender**, precio de lista, monto cobrado, notas, quién vendió, cuándo se vendió y quién lo registró. Se escribe desde dos lugares:

- `close_with_sale` (`backend/app/modules/leads/application/sales.py`): al mover el lead a una etapa `won`, el Kanban abre `SaleDialog` y pide servicio, paquete y monto. Mueve y registra en una sola transacción.
- `record_sale`: botón "Registrar compra" en la ficha del lead (`LeadSalesSection`), para una segunda compra o un cierre que se movió sin anotar.

Lo que el dashboard muestra con eso hoy es un solo panel "Ventas" dentro de la pestaña Resumen (`SummaryTab.tsx`, datos de `collect_sales` en `leads_queries.py`): compras, total cobrado, ticket promedio, monto por vendedor y los 8 paquetes más vendidos por cantidad. Sin tendencia, sin comparación contra el período anterior, sin ingresos por paquete, sin sesiones, sin descuentos, sin moneda.

Lo que **no** se guarda, y por lo tanto esta analítica no puede prometer todavía (ver §6): sesiones consumidas de cada paquete, pagos parciales o cuotas (el `adelanto` de la cita es otra tabla y no se cruza con la venta), anulaciones (una compra mal registrada se borra; queda en el historial del lead pero no como "anulada") y el costo publicitario que convertiría ingresos en ROI.

## 2. Referencias y qué se toma de cada una

| Fuente | Patrón | Cómo se aplica acá |
|---|---|---|
| [Shopify, Analytics overview](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard) y su [metric card](https://shopify.dev/docs/api/shopifyql/latest/web-components/metric-card) | Cada cifra lleva el cambio porcentual contra el período anterior y una sparkline; la comparación está activada por defecto | Fila de KPIs con delta "vs. 30 días anteriores" y sparkline de 12 puntos |
| [Layers, dashboards](https://docs.uselayers.com/help/analytics/dashboards) | Un solo rango y una sola comparación para todo el dashboard; el drill-down hereda el rango en vez de reiniciarlo | Se reutilizan el período y el alcance que ya tiene el dashboard; nada de filtros por panel |
| [Lightspeed, comparación de períodos](https://retail-support.lightspeedhq.com/hc/articles/49562364177819) | Base de comparación elegible (período anterior / mismo período del año pasado); tablas reordenables desde la cabecera | Tabla de paquetes ordenable por compras, ingresos, ticket o sesiones. "Mismo período del año pasado" queda para cuando haya un año de datos |
| [Daasity, sales dashboard](https://help.daasity.com/core-concepts/dashboards/report-library/retail-analytics/sales-performance-standard-sales-dashboard-for-urs) | La tabla de productos repite las métricas de la fila KPI y agrega la columna de cambio; "ventas altas con crecimiento bajo = saturando" | Columna "vs. anterior" por paquete y etiqueta "Nuevo" cuando no vendía antes |
| [Domo, dashboard design](https://www.domo.com/learn/article/dashboard-design-examples-best-practices) · [Close, sales dashboards](https://www.close.com/de/blog/sales-dashboard) | De 5 a 7 KPIs, jerarquía (resumen arriba, detalle abajo), relacionados juntos, un color fijo por período | 5 tiles, luego tendencia, luego tablas; verde = período actual, gris = anterior, siempre |
| [Zenoti, benchmark medspa 2025](https://www.zenoti.com/medspa-benchmark-report) | En medspas, 29 de cada 100 USD gastados en 2024 fueron paquetes, 38 % más que el año anterior (dato del proveedor) | Justifica que la unidad de análisis sea el **paquete** y no solo el servicio |
| [Pabau, KPIs de med spa](https://pabau.com/blog/med-spa-kpi-guide/) · [Prospyr, KPIs de clínica estética](https://prospyrmed.com/blog/post/med-spa-kpis-to-track-benchmark-formulas) | Ingreso por tratamiento, ticket promedio, conversión lead → paciente, utilización del paquete | Ingresos por servicio y ticket entran ahora; utilización del paquete y conversión por cohorte, en fase 2 |

Reglas de visualización que se siguen (del skill `dataviz` con el que se revisó la maqueta): un solo eje por gráfico (ingresos y compras se alternan, nunca se superponen), barras de ranking de un solo color, período anterior en gris como contexto, leyenda cuando hay dos series, tabla equivalente para cada gráfico, tooltips que agregan pero no son la única forma de leer un valor, delta con flecha y signo (el color no es el único portador). La paleta de gráficos del proyecto (`--color-viz-1..3`) pasó el validador en claro y oscuro.

## 3. Decisión: una pestaña "Ventas" en el dashboard, no una página aparte

El dashboard ya resuelve lo que una sección nueva tendría que volver a construir: el selector de período (7/30/90), el alcance "solo lo mío / todo el equipo" (`DashboardScope`, con `scope.mine(LeadSale.sold_by_user_id)` ya aplicado a las ventas), la caché de 30 s por negocio y usuario, y la entrada en la navegación. Una página aparte duplicaría el encabezado y partiría las métricas en dos lugares con filtros que podrían no coincidir.

El panel chico de Resumen se queda, pero achicado a tres cifras con delta y un enlace "Ver ventas" que abre la pestaña. Promover la pestaña a página propia tiene sentido recién si necesita filtros que el dashboard no tiene (por servicio, por vendedor, rango de fechas libre, exportar).

## 4. La pantalla, de arriba abajo

Todo responde al período y al alcance de la cabecera. "Período anterior" es siempre la ventana inmediatamente previa de la misma duración.

### 4.1 Fila de KPIs (5 tiles)

| Tile | Cálculo | Delta | Por qué está |
|---|---|---|---|
| Ingresos cobrados | `sum(amount)` | % vs. anterior, con sparkline | Lo que entró de verdad, no el precio de lista |
| Compras | `count(*)` | % vs. anterior, con sparkline | El volumen que pide el usuario ("cuántos se van vendiendo") |
| Ticket promedio | `sum(amount) / count` | % vs. anterior | Dice si se venden packs grandes o sesiones sueltas |
| Sesiones vendidas | `sum(sessions)` | % vs. anterior | Es la carga de atención que la clínica se compromete a dar; dos packs x10 pesan más que diez sesiones sueltas |
| Descuentos | `sum(list_price - amount)` y `% sobre lista` | puntos vs. anterior; **subir es malo** (ámbar) | Fuga de margen que hoy nadie ve |

Reglas: la dirección se muestra con flecha y signo además del color; cuando el período anterior no tiene ventas el delta dice "Sin período anterior" en vez de un porcentaje inventado; los importes llevan la moneda del negocio (ver §4.8).

### 4.2 Tendencia con período anterior

Área y línea verde para el período actual, línea gris para el anterior alineada por posición (día 1 contra día 1), leyenda con las dos etiquetas, crosshair con tooltip que lista los dos valores y la fecha de cada uno, navegable con flechas del teclado. Un control segmentado alterna **Ingresos / Compras**; nunca dos ejes en el mismo gráfico. Con 90 días la serie se agrupa por semana (13 puntos) porque 90 barras diarias de una clínica chica son ruido. Debajo, "Ver como tabla" con los mismos números.

### 4.3 Paquetes más vendidos (el corazón de la pestaña)

Tabla, no lista de barras: el usuario quiere comparar varias medidas por paquete. Fila = paquete del catálogo (servicio en gris arriba, nombre y sesiones debajo, barra de ranking de un solo color proporcional a la columna por la que está ordenada). Columnas: Compras · Ingresos · Ticket prom. · Sesiones · vs. anterior (cambio en compras contra el período previo; "Nuevo" si antes no vendía; "Sin ventas antes" en vez de un porcentaje). Orden por defecto: ingresos. Se muestran 10 filas y una fila "Otros N paquetes" con la suma, para que el total cierre sin estirar la tabla. Agrupa por `package_id` y, cuando el paquete ya no existe en el catálogo (`SET NULL`), por nombre de servicio + nombre de paquete, que es lo que la venta conserva.

### 4.4 Ingresos por servicio

Barras de ranking de un solo color con importe, porcentaje del total y número de compras. Es la vista por "problema del cliente" (la dueña piensa en tratamientos; el paquete es la presentación). Sin dona ni colores por servicio: con 7 servicios se vuelve ilegible y el proyecto solo tiene tres tonos de gráfico validados.

### 4.5 Por vendedor

Tabla: Compras · Ingresos · Ticket prom. · Descuento promedio. Como los demás rankings del dashboard, **no se acota al alcance**: el vendedor ve su fila marcada "(yo)" junto al resto del equipo. Un descuento promedio por encima del 8 % se marca en ámbar con un título que lo explica (umbral a confirmar con la dueña; debería ser configurable por negocio más adelante).

### 4.6 Últimas compras

Las 8 más recientes del período, con lead, paquete, servicio, vendedor, importe (y precio de lista si hubo descuento) y fecha; cada fila abre el chat del lead, igual que "Próximas citas". Da confianza en el dato y es el camino para corregir una compra mal registrada.

### 4.7 Estados

- **Vacío**: "Sin compras registradas en el período" y una línea que dice cómo se registran (mover a etapa ganada o "Registrar compra" en la ficha). Es el estado más probable el primer mes.
- **Sin período anterior**: los deltas lo dicen en texto; la línea gris no se dibuja si la ventana anterior no tiene ventas.
- **Recarga**: se conserva el render anterior con opacidad reducida (`placeholderData: keepPreviousData` en React Query); nada de skeleton al cambiar de período.
- **Error**: el mismo bloque rojo del dashboard.

### 4.8 Formato y móvil

La moneda del negocio vive en `AIProfile.currency`; hoy el dashboard muestra importes sin moneda. El bloque `sales` del payload debe traer `currency` y el frontend formatear con `Intl.NumberFormat('es-PE', { style: 'currency', currency })`; si el negocio no la configuró, se muestra el número a secas como hoy. En móvil los tiles van a dos columnas, las tablas tienen su propio scroll horizontal y la barra de ranking cae bajo el nombre del paquete.

## 5. Contrato de datos

Nuevo `backend/app/modules/leads/dashboard/sales_queries.py` que reemplaza a `collect_sales` de `leads_queries.py` (ese módulo vuelve a ser solo pipeline). `DashboardScope` gana `previous_start = start - days` para la ventana de comparación; el índice `idx_lead_sales_sold_at` ya cubre el rango doble.

```text
sales: {
  currency: string | null,
  totals:   { revenue, count, avg_ticket, sessions, discount, discount_rate, buyers },
  previous: { mismos campos } | null,          # null si la ventana anterior no tiene ventas
  trend:          [{ date, revenue, count }],  # diario; el frontend agrupa por semana con 90 días
  previous_trend: [{ date, revenue, count }],  # misma longitud, alineada por posición
  by_package: [{ package_id, service_name, package_name, sessions, count, revenue, avg_ticket, previous_count }],
  by_service: [{ service_id, name, count, revenue }],
  by_seller:  [{ user_id, name, count, revenue, avg_ticket, discount_rate }],   # nunca acotado al scope
  recent:     [{ id, lead_id, lead_name, service_name, package_name, amount, list_price, sold_at, seller_name }]
}
```

- El scope propio sigue filtrando por `sold_by_user_id`, como hoy.
- Mismo endpoint `/api/dashboard` y misma caché: no hay ruta nueva, así que `PUBLIC_ROUTES` y las guardas no cambian.
- Cambio de API → regenerar `frontend/src/api/schema.d.ts` en el mismo PR. `SummaryTab` pasa a leer `sales.totals`, así que backend y frontend del contrato van juntos.
- `by_package` ordena en el backend por ingresos y manda todas las filas (una clínica tiene decenas de paquetes, no miles); el orden por columna es del frontend.

Frontend: `features/dashboard/components/SalesTab.tsx` más `SalesPackagesTable.tsx` y tres primitivas nuevas en `primitives.tsx` (`StatTile` con delta y sparkline, `ComparisonTrendChart` con Recharts y dos series, `RankedList` con porcentaje), para que ningún componente pase de las 400 líneas que impone `architecture.test.ts`. Tests: unitarios de las agregaciones con dobles, consulta real en la suite de PostgreSQL (paquete borrado del catálogo, ventana anterior vacía, scope propio), y `DashboardPage.test.tsx` con la pestaña.

## 6. Lo que queda fuera y por qué

1. **Utilización de paquetes** (sesiones consumidas vs. vendidas, packs por vencer). Es el KPI que las referencias de medspa consideran central y el que más valor daría para recontactar; exige modelar la sesión realizada (ligar `appointments` a una venta, o una tabla `lead_sale_sessions` que la cita descuente). Decisión de producto, no de dashboard.
2. **Anulaciones y devoluciones.** Hoy se borra la fila; para medirlas haría falta `voided_at` / `void_reason` en `lead_sales` y que el dashboard las excluya pero las cuente. Recomendado antes de que haya historia que importe.
3. **Pagos parciales.** `amount` es lo acordado al vender; si la clínica cobra en cuotas, "Ingresos cobrados" sobreestima caja. Si eso pasa, hace falta `lead_sale_payments`.
4. **ROI por anuncio.** Ingresos ya hay; falta el costo y la atribución confiable (documento 14, API de Conversiones CTWA). Cuando exista, la pestaña suma "Ingresos por origen".
5. **Metas por vendedor o del mes.** Un medidor contra meta es trivial de agregar, pero hay que preguntarle a la dueña si trabaja con metas.
6. **Conversión lead → compra por cohorte.** El embudo actual ya tiene "Cliente"; cruzarlo con `lead_sales` daría "% de leads del período que compraron" con importe. Entra cuando se revise el embudo, no acá.

## 7. Entrega

| PR | Contenido | Tamaño |
|---|---|---|
| 1 | `sales_queries.py` con el bloque completo, `currency`, `schema.d.ts`, `SummaryTab` leyendo `totals`, tests de Postgres | M |
| 2 | Pestaña Ventas: tiles, tendencia comparada, tabla de paquetes, servicios, vendedores, últimas compras, estados, test de página | M |
| 3 (opcional) | `voided_at` en `lead_sales` y "Anuladas" en la pestaña; exportar CSV de la tabla de paquetes | S |

Los PRs 1 y 2 pueden ir seguidos en la misma semana; el 3 conviene decidirlo con la dueña.
