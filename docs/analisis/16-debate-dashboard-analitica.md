# 16 · Debate de especialistas: cómo hacer que el dashboard se use

Fecha: 2026-11-09 · Estado: **propuesta, sin implementar** (salvo lo indicado) · Origen: pedido de revisar la sección de analítica con varias miradas antes de seguir agregándole cosas.

Seis especialistas (investigador UX, diseñador UI, experto en usabilidad, experto en el negocio de clínicas estéticas, experto en anuncios de Meta y analista de datos) analizaron el dashboard por separado, después leyeron los análisis de los demás y debatieron, y un responsable de producto sintetizó el resultado. Los especialistas quedaron como subagentes en `.claude/agents/` y el debate se puede repetir sobre otro tema con el flujo `.claude/workflows/debate-expertos.js`.

Ya aplicado en algeronimo92/sugerencias-chat#143: frase-titular, marca de la semana incompleta y etiquetas de 12 px en el panel por tratamiento, y "Ingresos cobrados" pasó a "Monto vendido". La torta se mantuvo aunque el panel recomendó quitarla, porque la pidió el negocio.

## 1. Diagnóstico

Hoy el panel se usaría poco, y hay tres razones.

1. **Cuesta encontrarlo.** El ítem está como `primary: false` en `navigation.ts:24`, mientras que "Reportes" de bugs sí está en la barra principal.
2. **No contesta la pregunta de nadie.**
   - La pantalla de entrada siempre es Resumen (`DashboardPage.tsx:39`).
   - Resumen muestra 10 tarjetas de actividad interna, todas con el mismo peso (`SummaryTab.tsx:46-76`).
   - La plata aparece recién en el quinto panel.
   - No hay ni una cifra sobre anuncios, que es lo que la dueña paga cada semana.
3. **Varios números invitan a desconfiar.**
   - Hay paneles que no cambian al mover el período: `leads_queries.py:31-58` y `appointments_queries.py:116-124` no filtran por fecha.
   - La comparación pone el día de hoy, a medias, contra días completos (`scope.py:55-66`).
   - "Principales orígenes" se arma sobre `Lead.origen`, un campo que ningún flujo llena (`identity.py:171-178`).

Encima, nada trae a la gente de vuelta: no hay resúmenes ni avisos, y la vista no se conserva en la URL. Tampoco hay telemetría, así que nada de esto se puede confirmar con datos de uso.

## 2. Consensos

| Propuesta | La apoyan |
|---|---|
| **Números creíbles primero**: cada panel dice su ventana ("Histórico" o un bloque "Ahora"), el tramo en curso va rayado y fuera del %, y se agregan períodos de calendario (datos-1, usab-3, ux-5) | Los seis especialistas, y todos lo ponen como requisito previo de cualquier portada o resumen |
| **Atribución desde el `referral` del webhook**, no desde `wsp_ad` (ads-2, datos-3.1). Nadie en el backend escribe `wsp_ad`; el `referral` se guarda en `processor.py:257-258` | Anuncios, Datos, Negocio, UX, Usabilidad |
| **Pestaña Anuncios por cohorte**, con fila de orgánico y la cobertura de atribución a la vista (ads-1, ads-5, neg-2, datos-2) | Los seis |
| **Telemetría unificada** antes de rediseñar (ux-6, datos-5) | Los seis |
| **Estado en la URL** (pestaña, período, alcance) para volver y compartir (ux-5, usab-4) | Los seis |
| **Subir el panel a la navegación principal** (ux-3a) | UX, UI, Usabilidad |
| **Una sola primitiva de KPI y colores de gráficos desde los tokens** (ui-2, ui-3) | UI, Usabilidad, UX |
| **Panel por tratamiento sin torta**, con frase-titular y mini-tendencias con la misma escala (ui-5, datos-4d, usab-3d) | UI, Usabilidad, Datos, UX |
| **Anuncios como tarjeta en la portada**, no como portada, mientras la cobertura no se conozca | UX, UI, Usabilidad, Anuncios |
| **Sin ROAS ni costo por venta en la portada** mientras no exista el gasto | Anuncios, UI, Datos, Negocio |

## 3. Disensos y decisión

**Cuántas portadas.** UX y Negocio querían una para la dueña, otra para la admin y otra para la vendedora. Pero el sistema solo tiene los roles `admin` y `vendedor` (`auth.py:17-22`).
- **Decisión:** dos portadas, una para admin y otra para vendedor.
- **Razón:** no vale la pena crear un rol nuevo, con migración y permisos, para una diferencia que se resuelve con el orden de los bloques.

**Cuántas cifras grandes.** UI pedía 1 principal más 2 compactas. Usabilidad, 4. Negocio, 3.
- **Decisión:** 3 en móvil y 4 en escritorio, con una sola frase de "qué cambió". La barra de meta va dentro de la cifra principal, no como una tarjeta más.

**Cifra principal de la admin.** Negocio quería "Ingresos del mes" para la dueña y "Esperando respuesta" para la admin operativa.
- **Decisión:** la cifra principal es Ingresos. "Esperando respuesta" va primero en el bloque "Ahora", justo debajo.
- **Razón:** hay un solo rol admin, y la cifra que justifica el producto es la plata.

**Meta mensual.** Hoy no existe en el modelo.
- **Decisión:** la meta es opcional, en Ajustes. Sin meta, la portada compara contra "el mes pasado a esta altura" e invita a "Fijar meta".
- **Proyección:** no hay proyección lineal. Se muestra "Llevas S/X de S/Y, necesitas S/W por día". Desde el día 10 del mes, se agrega un rango.
- **Razón:** con ventas que llegan en tandas, una proyección lineal oscila mucho (lo señalaron Datos y Negocio).

**Canal del resumen semanal.** Anuncios y Negocio proponían push. UX respondió que el push solo llega a quien se suscribió (`push_service.py:62-66`).
- **Decisión:** correo más push al principio, midiendo la entrega por canal. Una plantilla de WhatsApp queda para una fase 2 si la entrega es baja.
- **Reglas del resumen:** sale solo con datos-1 terminado, usa semanas cerradas de lunes a domingo, lleva una cifra y una novedad, y trae un enlace profundo al mismo período.
- **Vendedora:** recibe solo lo accionable. Su avance en plata aparece únicamente si existe una meta y la dueña lo habilita.

**Fusionar Flujos y Etiquetas.** Usabilidad quería fusionarlas ya. UX advirtió que quizá son el único uso recurrente de la admin.
- **Decisión:** reordenar ya (Resumen, Ventas, Anuncios, Citas y embudo, Flujos, Etiquetas) y fusionar "Operación" después de 2 semanas de telemetría.

**Orden de la tabla de anuncios.** Anuncios proponía ordenar por ingreso. Datos objetó que eso premia al que más presupuesto tiene, y que las tasas con poca base engañan.
- **Decisión:** ordenar por leads y mostrar "ingreso por lead".
- **Base mínima:** con menos de 20 leads, la tasa va en gris como fracción ("2 de 3") y queda fuera de "mejor y peor anuncio".
- **Cobertura:** si menos del 50 % de los leads tiene anuncio identificado, solo se muestra "Anuncio vs orgánico".

**Semáforo de ROAS.** Negocio objetó con un argumento sólido: en estética el valor está en la recompra.
- **Decisión:** no habrá semáforo fijo. Se muestran el costo por compradora junto al ticket y el ROAS a 90 días con recompras. Los umbrales los configura cada negocio.

**Gasto publicitario.**
- **Decisión:** primero se importa el CSV de Ads Manager por anuncio y mes, no campos a mano. La Marketing API (`ads_read`, App Review) va después, y solo si al menos el 30 % de los negocios carga el CSV.

## 4. Plan priorizado

| Prioridad | Propuesta | Qué cambia para el usuario | Impacto en uso | Esfuerzo | Cómo medirlo | Dependencias |
|---|---|---|---|---|---|---|
| 0 (esta rama, antes del merge) | Panel por tratamiento | Sin torta; frase-titular; color fijo por tratamiento; tramo incompleto rayado; etiquetas de 12 px | Medio | S | Prueba de 5 segundos con la dueña: "¿qué tratamiento creció?" | Hoy el color depende del ranking (`serviceBreakdown.ts:36-40`) y la semana más vieja puede quedar corta (`:48-52`) |
| 1 | Telemetría y estado en la URL | Volver del chat lleva a la misma vista; se puede compartir un enlace | Medio (habilita el resto) | S | Es la línea base: 2 semanas | Endpoint con guard y tabla por tenant; regenerar `schema.d.ts` |
| 1 | Números creíbles (datos-1) | Cada panel dice su ventana; nada de "-12 %" falso a la mañana; "Semana pasada", "Este mes", "Mes pasado" | Alto | M | Test: con ventas iguales en los dos períodos, el cambio es 0 % a cualquier hora; KPI igual a la suma del gráfico | Bloque `period` con `partial` en el backend; regenerar tipos |
| 1 | Navegación | "Resultados" en la barra principal de móvil para admin; "Reportes" pasa a "Más" | Alto | S | Aperturas por `source=nav` | — |
| 2 | Atribución automática del lead (ads-2) | El origen se llena solo: anuncio (con miniatura y título) u orgánico | Alto | S/M | % de leads nuevos con origen; cobertura semanal | Columnas nuevas en el lead o tabla `lead_attribution` (Alembic); backfill desde `provider_payload`; consulta de cobertura en una copia, nunca con `backend/.env` |
| 2 | Portadas por rol con bloques "Ahora" / "En el período" | Admin: Ingresos, Compras y % lead→compra, con "Ahora" debajo. Vendedora: Mis ventas, Esperando respuesta, Tareas vencidas y Citas de hoy | Alto | M | % de sesiones con un clic de acción; tiempo hasta el primer clic, por rol | Prioridad 1; KPI único (ui-2) |
| 3 | Embudo real por cohorte (datos-2) | "De 100 que escribieron, 14 compraron y dejaron S/X"; la compra sale de `lead_sales`, no de la etapa | Alto | M | Conciliación con `lead_sales` (test en Postgres) | — |
| 3 | Pestaña Anuncios | Tabla por anuncio: leads, % que agenda, % que compra, ingreso por lead, % respondido en menos de 5 min, fila de orgánico y cobertura visible | Alto | M | Visitas los lunes y martes; clics en "ver chats del anuncio"; si la dueña pausa o escala un anuncio por lo que vio | Prioridades 2 y 3 |
| 4 | Resumen semanal | Lunes a las 8:00: una cifra, una novedad y el enlace a la semana cerrada | Alto | M | Entrega y apertura por canal; % de admins que abren el panel 4 lunes seguidos | Prioridad 1 completa; preferencias por usuario |
| 4 | Franja en la bandeja y "A quién llamar" (neg-3) | Números del día en la bandeja; listas de recompra, leads calientes y no-shows | Alto | M | Clics con `source=bandeja`; ventas a esos leads en 14 días | Ciclo de mantenimiento por servicio en el catálogo |
| 5 | Nuevas compras vs. recompras | Ventas separa las compras nuevas de las recompras | Medio | S | Tasa de recompra a 90 días | — |
| 5 | Importar el gasto por CSV (ads-3, fase 1) | Costo por lead, costo por compradora y ROAS a 90 días | Alto | M | % de negocios que cargan el gasto cada mes | Tabla `ad_spend` |
| 6 | Accesibilidad y estados | Pestañas ARIA, skeletons, errores con "Reintentar", vacíos que explican cómo llenarlos | Bajo | S | axe y prueba de teclado | Se hace junto con ui-2 |
| 7 | Marketing API y API de Conversiones (ads-6, doc 14) | El gasto llega solo; Meta optimiza hacia compradoras | Medio | L | `meta_conversions_sent_total` | `ads_read`, App Review, token por cuenta |

Hay otro cambio barato que conviene hacer ya: renombrar "Ingresos cobrados" a "Ventas cerradas (monto acordado)". `lead_sales.amount` guarda lo acordado al vender, no lo que entró a caja.

## 5. Qué medir primero

Antes de cualquier cambio visible conviene tener 2 semanas de línea base.

**Eventos:**
- `dashboard_viewed{rol, pestaña, período, alcance, source: nav|enlace|push|correo|bandeja, device}`
- `dashboard_interaction{acción, destino: chat|filtro|tareas|pestaña}`

**Dónde guardarlos:** el `user_id` va solo en la tabla del tenant. En Prometheus, solo etiquetas de baja cardinalidad.

**Indicadores:**
- Usuarios activos semanales del panel, por rol.
- Pestañas más vistas. Esto decide si Flujos y Etiquetas se fusionan.
- % de sesiones que terminan en una acción.
- Tiempo hasta la primera interacción.
- Vueltas de la bandeja al panel dentro de la misma sesión.

**Medidas de datos, no de uso:**
- **Cobertura de atribución:** leads de los últimos 90 días con `referral` en el primer mensaje, sobre el total de leads, comparada con las filas de `wsp_ad` con `lead_id`. Se corre sobre una copia o una réplica. Esta cifra define si se puede mostrar el ranking por anuncio.
- **Leads con origen:** % de leads con `origen` no nulo hoy.

## 6. Preguntas para la dueña

1. Cada lunes, ¿qué número decide si la semana fue buena: lo facturado, las compradoras o el costo por clienta?
2. ¿Hay una meta mensual? ¿En soles o en paquetes, total o por asesora? ¿Las asesoras pueden ver su avance en plata y el de las demás?
3. Para usted, "ingresos", ¿es lo acordado al vender o lo que entró a caja? ¿Qué tan seguido hay cuotas, adelantos o devoluciones?
4. ¿Decide la pauta por anuncio o por campaña? ¿Quién la maneja, usted o una agencia? ¿Tiene acceso de administradora a la cuenta publicitaria?
5. ¿Podría exportar cada mes el CSV de Ads Manager y subirlo al CRM?
6. ¿Por qué canal prefiere el resumen del lunes: WhatsApp, correo o notificación? ¿A qué hora?
7. ¿Cada cuánto vuelve una clienta por mantenimiento de cada tratamiento (toxina, HIFU, láser)?
8. ¿Hay anuncios "de entrada" (evaluación gratis, limpieza) que acepte que pierdan plata porque traen clientas que después vuelven?
9. ¿Usa hoy Flujos y Etiquetas en el panel, o solo la admin?
