# 12 · Propuesta: trazabilidad de envíos y actualización de la PWA

Fecha: 2026-11-09 · Estado: **superada por el veredicto y la contrapropuesta de [13-veredicto-y-contrapropuesta-trazabilidad-pwa.md](13-veredicto-y-contrapropuesta-trazabilidad-pwa.md)** (A1 descartada: sin DDL; A2, B, C1 y C2 modificadas). Se conserva como registro del diagnóstico y de las opciones evaluadas · Origen: incidente del chat de JOSE HEREDIA (DermicaPro).

## 1. El incidente que motiva esto

Una vendedora creyó haber lanzado el flujo **Hollywood peel** (49 bloques) sobre un lead. En el teléfono se veía el video con el texto "El Hollywood Peel es un tratamiento…", pero en el CRM no aparecía el panel de automatización en curso y la persona admin no entendía qué había pasado ni dónde mirar.

Lo que se comprobó en producción con la sesión de admin:

| Dato | Valor |
|---|---|
| Ejecuciones de automatizaciones sobre el lead (toda su historia) | 3: Bienvenida y Seguimiento clientes (sistema, 9:23) y **Ubicacion** (manual, Grecia, 10:03, completada) |
| Ejecuciones de Hollywood peel sobre el lead | **0** (también con omitidas visibles) |
| Mensaje de las 10:05 | video con el texto exacto de la plantilla interna **"slogan hoollywood peel"** (id 1), `outbox_status = sent`, `meta_status = delivered` |
| Primer bloque de Hollywood peel | cambiar servicio a "Hollywood Peel - Rostro" → el lead sigue con servicio vacío |
| Segundo bloque de Hollywood peel | enviar la plantilla id 1 → es el mismo contenido que salió a las 10:05 |
| Cuarto bloque (5 s después) | "PARA DARTE UNA COTIZACIÓN EXACTA…" → nunca se envió |

Conclusión: se envió **la plantilla a mano**, no el flujo. El motor, el outbox y la visibilidad por usuario funcionaron bien. El problema es de producto: nada en la pantalla permite distinguir una plantilla enviada por una persona del primer paso de un flujo, y la vendedora pudo estar trabajando con un build viejo del frontend porque la PWA no fuerza la actualización.

## 2. Problemas de producto que quedaron expuestos

- **P1. Un mensaje saliente no dice su origen.** La base guarda `wsp_messages.sent_by_user_id` (NULL en envíos de automatización y en ecos del celular), pero la API del hilo no lo expone y la burbuja no lo pinta. No existe ninguna columna que ligue un mensaje con la ejecución de flujo que lo generó; el único rastro es `message_outbox.dedupe_key` con la forma `automation:<execution_id>:<posición>:<llamada>:<índice>` y `automation_executions.action_results[].message_ids`.
- **P2. Plantilla y flujo indistinguibles.** Es legítimo que un flujo empiece con una plantilla existente (así está diseñado el bloque "Enviar plantilla"). Pero el selector de plantillas del chat no indica que esa plantilla es el primer paso de un flujo, y el botón "Iniciar flujo" está a dos íconos de distancia en el mismo compositor.
- **P3. La PWA deja al usuario con un build viejo.** `registerType: "prompt"`, sondeo cada 60 minutos, aviso descartable sin recordatorio. Una vendedora que no cierra la pestaña puede pasar el día entero con la versión anterior. La decisión de no recargar sola está bien fundamentada (borrar un borrador o un audio en grabación es peor), pero hoy no hay punto medio.
- **P4. Una ejecución terminada no deja rastro en el chat.** El panel de automatizaciones solo lista ejecuciones activas; un flujo de dos envíos se completa en 200 ms y el panel desaparece. El rastro existe (Historial del admin, "Flujos enviados" de la vendedora), pero no donde se está mirando.

## 3. Opciones evaluadas

### P1. Origen del mensaje

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| 1a. Derivar en lectura desde `message_outbox.dedupe_key` | Join con el outbox y parseo del prefijo `automation:<id>` | Sin DDL | Parsear una cadena pensada para dedupe, no para auditoría. Un join más por página de hilo. Acopla el hilo al formato interno de otro módulo |
| 1b. Columna `wsp_messages.automation_execution_id` con FK | El flujo la rellena al encolar | Modelo explícito | FK cruzada conversations → automations; `message_history.py` solo puede tocar `leads` según `FOREIGN_TABLES`, que **solo se achica**. Obligaría a un join cruzado o a otra consulta |
| **1c. Columna `wsp_messages.origin JSONB` (recomendada)** | Snapshot del origen al encolar: `{"kind":"automation","execution_id":63802,"rule_id":1,"rule_name":"Hollywood peel"}`, `{"kind":"scheduled","scheduled_id":…}`; el envío humano no necesita nada más que `sent_by_user_id` | Sin FK cruzada, sin join en lectura, el nombre del flujo queda tal cual era en ese momento (igual que la ejecución guarda su versión del flujo). Extensible a futuros orígenes (respuesta del bot, n8n) | Un JSONB sin constraint de forma: se valida en aplicación. Dato denormalizado: si se renombra un flujo, los mensajes viejos conservan el nombre antiguo, que es lo deseable en una auditoría |

Para el **nombre de la persona** que envió, `message_history.py` no puede unir `users` (ver `FOREIGN_TABLES`). Alternativas: resolver los nombres con una segunda consulta por un puerto público de `auth` (hoy `auth/public.py` no expone nada de usuarios por id; habría que agregar `user_names(ids)`), o copiar el nombre dentro de `origin` al encolar. Recomendación: **puerto público de `auth`** con una consulta por página de hilo (los ids son pocos y repetidos), para no congelar nombres de personas que sí cambian.

### P3. Actualización de la PWA

| Opción | Pros | Contras |
|---|---|---|
| 3a. `registerType: "autoUpdate"` | Trivial | Recarga en cualquier momento; exactamente lo que el comentario de `vite.config.ts` quiso evitar |
| 3b. Sondear más seguido | Trivial | Sigue dependiendo de que el usuario toque "Actualizar" |
| **3c. Sondear en los momentos útiles y aplicar cuando es seguro (recomendada)** | Resuelve el caso real sin perder trabajo | Hay que definir "seguro" con precisión (ver abajo) |
| 3d. Señal desde el servidor (`version.json` o evento WebSocket tras el deploy) | Detecta el build nuevo al instante, independiente del service worker | Más plumbing: el deploy blue-green tendría que exponer el id de build; segunda fase |

"Seguro" para recargar: sin texto en el borrador del chat actual (`draftStore`), sin grabación de audio en curso, sin envíos en vuelo (`queryClient.isMutating({ mutationKey: messageKeys.sending(chatId) }) === 0`), sin diálogo abierto (plantilla, programar, adjuntar). Si no es seguro, el aviso se mantiene y **se vuelve a ofrecer al cambiar de chat**, no una hora después.

### P2 y P4

- P2. Marcar en el selector de plantillas las que son el primer envío de un flujo manual ("Es el inicio del flujo Hollywood peel"). El dato existe en `published_flow_definition` (acciones `send_template` con `template_id`); haría falta una consulta pública en `automations` que `catalogs` o el frontend consulten. Valor medio, coste medio. Se vuelve menos necesario si P1 está resuelto, porque la burbuja ya dirá "Plantilla enviada por Grecia" en vez de dejar la duda.
- P4. En el panel del chat, mostrar plegado el último flujo terminado del día ("Último flujo: Ubicacion · completado 10:03 · Grecia"). Usa la misma API (`GET /api/automations/executions?chat_id=…`) sin filtro de estado: cambio solo de frontend, pequeño.

## 4. Propuesta

Tres entregas, en este orden. Cada una es útil por sí sola.

### Entrega A · Cada burbuja saliente dice quién la envió (P1)

Dos PRs, porque DDL y contrato de API van separados por convención del repo.

**A1 · Esquema y escritura**
- Revisión Alembic explícita (`wsp_messages` está en `EXTERNAL_TABLES`, autogenerate no la compara): `ALTER TABLE wsp_messages ADD COLUMN origin JSONB NULL`. Columna nullable, sin reescritura de la tabla.
- Backfill en la misma revisión desde `message_outbox.dedupe_key LIKE 'automation:%'` uniendo con `automation_executions` y `automation_rules` para el nombre. El outbox no se purga, así que los envíos históricos de flujos quedan etiquetados. Programados: desde `scheduled_messages` si conserva el id del mensaje encolado; si no, solo hacia adelante.
- `queue_messages` acepta `origin: dict | None`; `with_outbox_dedupe` (automations) lo pasa con la ejecución, y el worker de programados pasa el suyo. Validación de forma en aplicación (`kind` en un `Literal`).
- Modelo `WspMessage.origin`; `alembic check` debe seguir en verde.
- Tests: dobles del outbox (que el origin llegue a la fila), test de capas sin cambios de allowlist.

**A2 · API y pantalla**
- `Message` gana `sent_by_name: str | None` y `origin: MessageOrigin | None`. `message_history.fetch_messages` resuelve nombres con un nuevo puerto `auth.public.user_names(ids)` (una consulta por página). Regenerar `schema.d.ts` en el mismo PR.
- Frontend: un componente nuevo `MessageOrigin.tsx` (MessageBubble ya está en `KNOWN_LARGE_COMPONENTS`, no crece) bajo la hora y los ticks: "Grecia G." · "Flujo Hollywood peel" · "Programado · Grecia G." · "Desde el celular" (eco por webhook sin usuario). Se muestra en el hilo y en la vista previa del chat (`ChatPeekDialog`). Sin dato, no se muestra nada: los mensajes anteriores al backfill no cambian de aspecto.
- Reglas de visibilidad: todos los roles lo ven. El nombre de quien atiende un chat compartido no es información sensible dentro del equipo y hoy ya se infiere del dashboard.
- Tests: `MessageBubble.test.tsx` y un test del componente nuevo.

**Riesgos**: el backfill corre sobre ~190 k filas de `wsp_messages` con un `UPDATE … FROM` filtrado por prefijo; en producción se ejecuta con el advisory lock de `scripts.migrate` como cualquier revisión. Si la base de un tenant fuese mucho mayor, el backfill se saca a un `python -m scripts.<x> --apply` por lotes.

### Entrega B · La PWA se actualiza cuando es seguro (P3)

Un PR, solo frontend.
- Sondear `registration.update()` también al volver la pestaña a primer plano (`visibilitychange`) y al reconectarse el WebSocket (`useRealtime` ya tiene `onopen`), con un límite de una comprobación cada 5 minutos. El sondeo horario se mantiene como red de seguridad.
- Cuando hay build nuevo y la pantalla está en estado seguro (definición en §3), mostrar durante 10 segundos "Actualizando DermicaPro…" con botón "Ahora no" y recargar al terminar. Si no es seguro, dejar el aviso fijo y volver a ofrecerlo al cambiar de chat.
- Registrar en un `console.info` el build aplicado; sin telemetría nueva.
- Tests: hook de decisión "es seguro recargar" con casos de borrador, grabación y envío en vuelo.

Fase opcional B2: `version.json` generado en el build con el SHA de git y comparado al reconectar, para no depender del ciclo del service worker. Solo si B se queda corta.

### Entrega C · Rastro de flujos y plantillas en el chat (P4 y P2)

- C1 (frontend, pequeño): el panel del chat muestra plegado el último flujo terminado del día con estado, hora y quién lo inició. Misma API, sin backend.
- C2 (opcional, medio): etiqueta en el selector de plantillas cuando la plantilla es el primer envío de un flujo manual. Requiere una consulta pública nueva en `automations`. Se decide después de ver A en uso.

## 5. Orden, tamaño y qué no entra

| Entrega | Tamaño | Dependencias | Valor |
|---|---|---|---|
| A1 | mediano (1 revisión + 3 archivos backend + tests) | ninguna | base de todo lo demás |
| A2 | mediano (API + puerto auth + componente + tests + `schema.d.ts`) | A1 | resuelve la ambigüedad del incidente para todo el equipo |
| B | pequeño | ninguna | evita builds viejos sin perder trabajo |
| C1 | pequeño | ninguna | cierra el hueco visual del panel |
| C2 | medio | A en uso | se decide después |

Fuera de alcance: cambiar el diseño del flujo Hollywood peel o de sus plantillas (decisión de negocio), telemetría de versiones por usuario, y cualquier cambio en el motor de automatizaciones, que en este incidente hizo exactamente lo que debía.

## 6. Cómo verificar cada entrega

- A: en un chat de prueba, enviar una plantilla a mano, lanzar un flujo manual que envíe la misma plantilla y programar un mensaje. Las tres burbujas tienen que decir orígenes distintos. Revisar un mensaje de un flujo anterior al cambio: debe decir el nombre del flujo gracias al backfill.
- B: desplegar un build nuevo con la pestaña abierta en segundo plano y un borrador escrito; al volver, debe aparecer el aviso sin recargar. Borrar el borrador y cambiar de chat: se aplica sola.
- C1: lanzar Ubicacion en un chat; al terminar, el panel debe seguir mostrándolo como "último flujo" el resto del día.
