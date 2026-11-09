# 13 · Veredicto y contrapropuesta sobre la propuesta 12

Fecha: 2026-11-09 · Estado: contrapropuesta lista para decidir · Revisa: [12-propuesta-trazabilidad-envios-y-actualizacion-pwa.md](12-propuesta-trazabilidad-envios-y-actualizacion-pwa.md).

## 1. Método

La propuesta 12 se sometió a un debate adversarial por áreas. Seis áreas (automatizaciones, backend, frontend, procesos en segundo plano, experiencia de usuario, interfaz), cada una con un experto que defendía la propuesta y un abogado del diablo que intentaba refutarla, en dos rondas (ataque, réplica con concesiones, cierre). Un juez técnico leyó las seis transcripciones, abrió el código donde dos áreas se contradecían y emitió el veredicto. Toda afirmación debía citarse como ruta:línea; lo que no tenía evidencia quedó marcado como supuesto.

Participaron 25 agentes. Los hallazgos decisivos del juez se verificaron después a mano en el código (§3).

## 2. Veredicto por entrega

| Entrega original | Decisión | Por qué |
|---|---|---|
| **A1** · columna JSONB `wsp_messages.origin` + backfill en la revisión Alembic | **Descartar** | Tres premisas no resisten el código. `message_outbox` es tabla de `conversations` y el hilo ya le hace LEFT JOIN (`message_history.py:86`), así que el origen se deriva en lectura sin DDL ni allowlists. Congelar `rule_name` es redundante: las reglas se borran en blando (`management.py:100`) y las ejecuciones ya devuelven `rule_name` y `rule_deleted`. El backfill dentro de la revisión es peligroso: `alembic/env.py:216-218` corre toda la revisión en una transacción, así que el `ADD COLUMN` retiene ACCESS EXCLUSIVE sobre `wsp_messages` durante todo el `UPDATE` mientras el color viejo del blue-green sigue sirviendo. |
| **A2** · API (`sent_by_name` + `origin`) y etiqueta bajo la hora de la burbuja | **Modificar** | El dato hace falta, pero sin DDL y con otro contrato y otra forma en pantalla. Un solo objeto `origin` discriminado (`user`, `automation`, `scheduled`, `echo`) derivado de tres señales ya disponibles: `sent_by_user_id`, el prefijo de `dedupe_key` (`automation:<id>` y `scheduled:<id>`) y la ausencia de fila de outbox para el eco del celular. `sent_by_user_id` solo no basta: programado y manual son indistinguibles por él. En pantalla no va en el pie: mide 10 px con contraste 2,75:1, en video vive sobre el reproductor y hay cuatro pies distintos. Va como tarjeta de evento en la línea de tiempo y, de forma secundaria, como etiqueta sobre el primer mensaje de cada grupo por origen. |
| **B** · sondeo al volver y reconectar; recarga sola cuando es seguro | **Modificar** | El sondeo es correcto y barato. La recarga automática, tal como estaba escrita, no: el prompt se monta fuera del router, la definición de "seguro" omitía grabación, adjuntos pendientes, envío de media, respuesta citada y el editor de flujos; `messageKeys.sending(null)` no es un prefijo; y `skipWaiting` más `cleanupOutdatedCaches` ya rompe otras pestañas con el botón manual, cosa que B multiplicaría. La cuenta atrás de 10 s es un límite de tiempo contrario a WCAG 2.2.1. El borrador no es motivo para bloquear: vive en `localStorage`. `version.json` sobra: `sw.js` e `index.html` ya salen sin caché. |
| **C1** · fila plegada con el último flujo terminado | **Modificar** | El hueco es real y el dato ya está en caché (`useAutomationExecutions({ chatId })` sin filtro de estado). Pero una fila sobre el compositor compite con el aviso de ventana de 24 h y responde "Ubicacion · 10:03", no "Hollywood peel no arrancó". La misma información va como tarjetas de evento en el hilo. Falta exponer `parent_execution_id` y `parent_rule_name` para que una ejecución hija diga "Hollywood peel › Ubicacion". |
| **C2** · píldora en el selector de plantillas | **Modificar** | La adyacencia de "Plantillas" e "Iniciar flujo" existe (botones de 36 px solo con `title`, pegados, sin etiqueta accesible, y `title` no existe en táctil). Pero la píldora no sirve: la fila ya apila píldoras a 9 px, no hay recorredor de grafo en el frontend y "primer envío" es ambiguo. Además la premisa de que la vendedora se confundió no está probada: una plantilla con video pasa por un diálogo de vista previa con "Enviar N elementos". Entra lo barato y de accesibilidad; el resto se mide después. |

## 3. Hallazgos del código que decidieron el veredicto

Los cinco primeros están verificados a mano tras el debate.

- `backend/app/modules/conversations/message_history.py:86` ya hace `outerjoin(MessageOutbox)` y deriva `error_detail` en lectura: el patrón para derivar `origin` sin DDL existe.
- `backend/alembic/env.py:216-218` ejecuta cada revisión en una sola `begin_transaction()`, y `backend/app/tenancy/provisioning.py:184-194` la envuelve en `engine.begin()` con advisory lock. Un `UPDATE` en la misma revisión que un `ADD COLUMN` retiene el lock exclusivo mientras el color viejo sirve (`scripts/deploy-bluegreen.sh:209-214`). No existe `lock_timeout` en el repo.
- `backend/app/modules/automations/application/management.py:100` borra reglas en blando. El CASCADE de `rule_id` solo actuaría en un borrado físico que no existe en `app/` ni `scripts/`.
- `backend/app/modules/conversations/application/scheduling.py:68` encola programados con `dedupe_key = "scheduled:<id>"` y autor el creador. Solo el prefijo distingue programado de manual.
- Los ecos del celular (`processor.py:251` → `inbound.py:53`) se guardan con `sender = "vendedor"` sin fila de outbox: el eco se reconoce por ausencia de outbox.
- `sql_outbox.py:117` y `:70` devuelven `serialize_message` crudo y esa respuesta reemplaza la burbuja optimista (`outbound.py:30-32`): el origen debe calcularse también ahí, no solo en `fetch_messages`.
- `automations/domain/execution.py:124-126` guarda `parent_execution_id` y `parent_rule_id` en `event_payload`; `queries.py:45-70` no los expone.
- `frontend/src/app/providers.tsx:20` monta `PwaUpdatePrompt` fuera de `RouterProvider`; `routes.tsx:180` declara `chat/:chatId`, así que cambiar de chat sí es navegación.
- `ChatComposer.tsx:104,115,116` (`isRecordingAudio`, `pendingMedia`, `isSendingMedia`) no se resetean al cambiar de chat; `VisualFlowBuilder.tsx:371-379` registra `beforeunload` con estado local.
- Contraste medido: `wa-faint` sobre `wa-out` 2,75:1; `wa-muted` sobre `wa-chat` 3,88:1; `#54656f` 5,06:1; en oscuro `wa-muted-dark` 6,10:1. El pie es `text-[10px]` y hay cuatro pies: `MessageBubble.tsx:507-521` y `:530-557`, `AlbumBubble.tsx:151`, `ChatPeekDialog.tsx:45`.
- `ChatThread.tsx:492-497` agrupa burbujas por `sender`, que solo distingue cliente de negocio: agrupar por origen es trabajo real.
- `TemplatePicker.tsx:32` manda las plantillas con adjuntos a `TemplateSendDialog` ("Vista previa antes de enviar", "Enviar N elementos"): la confusión de la vendedora es un supuesto no verificado; la de la admin está documentada.
- `auth/public.py:22` ya exporta `list_active_sellers`, que filtra `is_active`: el puerto `user_names(ids)` se justifica por los usuarios inactivos.

## 4. Contrapropuesta

Orden: **A (un PR backend + un PR frontend) → B1 → C2 mínimo → B2 → deuda del pie**. Ninguna entrega lleva DDL; `wsp_messages` no se toca. C1 queda absorbida por A.

Se quita de la propuesta 12: la columna JSONB `origin`, el backfill en revisión, `rule_name` congelado, `sent_by_name` como campo suelto, la etiqueta bajo la hora, la cuenta atrás de 10 s, la fila plegada de C1, la píldora de C2 y `version.json`.

### A · Origen del mensaje, sin DDL

**PR A-backend (contrato).**
- `conversations/message_history.py`: al `outerjoin` existente añadir `MessageOutbox.id` y `MessageOutbox.dedupe_key`; seleccionar también `WspMessage.sent_by_user_id`.
- Función pura `conversations/message_origin.py::classify(sender, sent_by_user_id, outbox_row_present, dedupe_key)`: `automation` si `dedupe_key` empieza por `automation:` (con `execution_id`), `scheduled` si `scheduled:`, `echo` si `sender == "vendedor"` sin fila de outbox, `user` si hay `sent_by_user_id`; `None` para el cliente. Test propio con la clave que produce `with_outbox_dedupe` (ya fijada en `test_automation_actions.py:668`) y con un eco sin outbox.
- `schemas.py::Message` gana `origin: MessageOrigin | None` con `kind: Literal[...]`, `user_id`, `user_name`, `execution_id`. Nada más.
- `auth/public.py` exporta `user_names(ids) -> dict[int, str]` sin filtrar `is_active`; una consulta por página de hilo.
- Una función `attach_origins(items)` que llaman `fetch_messages` y los adaptadores que devuelven mensajes al cliente (`sql_outbox.py:117`, `queued_by_dedupe_key`, respuestas de `outbound_api.py`). El tiempo real no cambia: el hilo se refetchea con `chats_updated`.
- `automations/queries.py::_execution_dict` expone `parent_execution_id` y `parent_rule_name`; `schemas.py` tipa `action_results` (`position`, `type`, `status`, `message_ids`). Son cambios de lectura, no del motor.
- Regenerar `schema.d.ts`. Test de capas sin tocar allowlists.
- Verificar: plantilla a mano, flujo manual con la misma plantilla, programado y eco desde el celular dan `origin.kind` distintos; un flujo antiguo trae `execution_id` sin backfill porque el outbox no se purga.

**PR A-frontend (pantalla).**
- `features/chats/components/MessageFooter.tsx` que sustituye los cuatro pies (los dos de `MessageBubble`, `AlbumBubble`, `PeekMessage`, migrando sus hex a tokens). `MessageBubble` achica; nada de origen dentro del pie ni del overlay del video.
- Tarjeta de evento `FlowEventCard` en `useChatTimeline` (como `stage_changed`): "Grecia inició Hollywood peel · 10:05", "completado", "cancelado", a 12 px con token nuevo `--color-wa-faint-strong: #54656f` en claro (5,06:1); en oscuro basta `wa-muted-dark`. Fuente: `useAutomationExecutions({ chatId })` filtrado en cliente por `start_source in (manual, flow)` y `status != skipped`, mostrando `parent_rule_name › rule_name` en hijas. Misma clave de caché que el panel para no partirla.
- Etiqueta secundaria sobre el primer mensaje de cada grupo **por origen** ("Flujo Hollywood peel", "Programado · Grecia", "Desde el celular"), `text-xs font-semibold` como `InternalNoteCard`. Reagrupar en `ChatThread.tsx:492-497` por `origin.kind + user_id/execution_id`, no por `sender`.
- `optimisticMessage` recibe `origin: { kind: 'user', user_id: me.id, user_name: me.name }`; actualizar los fixtures que construyen `Message` completo. El frontend asume `user` si `origin` falta.
- Verificar: `MessageBubble.test.tsx`, test de `MessageFooter`, test de agrupación por origen, `npm run build`, revisión en 360 px.

### B1 · Sondeo y aviso que no se pierde (solo frontend)
- `PwaUpdatePrompt.tsx`: `registration.update()` al volver a primer plano y en la transición desconectado → conectado del WebSocket (`useChatSocketConnected` ya es un store), con tope de una comprobación cada 5 minutos: `RECONNECT_DELAY_MS` es de 3 s y un deploy produce reconexiones en ráfaga. Mantener el sondeo horario.
- Aviso persistente: toast con "Actualizar" y "Ahora no" que no apaga `needRefresh` al descartarse y se vuelve a mostrar al volver a primer plano y al cambiar de chat. `ChatWorkspace` escribe el `chatId` en un store `shared/pwaUpdate.ts` porque el prompt no tiene router. Chip "Versión nueva" en la cabecera como estado visible.
- Sin recarga automática todavía. `console.info` del build aplicado.
- Verificar: test del límite de frecuencia y de la re-oferta.

### C2 mínimo · Accesibilidad de los disparadores
- `aria-label` en `TemplatePicker.tsx:64` y `FlowPicker.tsx:53-58`. Mover `FlowPicker` a la cabecera junto al botón del bot (`ChatThread.tsx:392`, ya de 44 px), fuera de la fila de composición. Sin píldoras nuevas a 9 px.
- El subtítulo "Inicia el flujo X" y la confirmación previa al lanzamiento quedan para después de medir con A en uso.

### B2 · Recarga automática segura
- `shared/activity.ts` sin reglas de negocio: `hold(kind) → release()`. Lo marcan `ChatComposer` (grabación, `pendingMedia`, `isSendingMedia`), `ChatThread` (`replyTo`, modo selección) y `VisualFlowBuilder` (`hasUnsavedChanges`).
- `messageKeys.sendingAny = ['send-message']` en `keys.ts`.
- Lease entre pestañas en `localStorage['pwa-activity:<tabId>']` renovado cada 10 s (patrón de `draftStore.ts:66-73`); aplicar solo si no hay leases frescos, `activity` vacío, `isMutating(sendingAny) === 0` y `!hasOpenOverlay()`. El botón manual pasa por el mismo guard.
- Momento de aplicación: una navegación dentro del CRM con texto visible "Actualizando…" antes del `reload`. Cuál navegación es decisión de producto (§5). Sin cuenta atrás.
- Verificar: tests del hook "es seguro" con cada `hold`; prueba manual con dos pestañas.

### Deuda del pie (PR aparte, no bloquea)
Botón "Guardar como plantilla" a 24 px, "Editado" con texto visible, contraste del pie a 12 px con `wa-faint-strong`. Ticket lateral: `pendingMedia` sobrevive al cambio de chat (`ChatComposer.tsx:115`, sin `key` por chat en `ChatThread.tsx:586`).

### Fase 2 condicional
Columna tipada `wsp_messages.automation_execution_id BIGINT` con FK `ON DELETE SET NULL`, escrita por `SqlOutboxStore.queue` desde un campo explícito del ítem. Solo si derivar en lectura demuestra costar o aparece un origen no derivable. Si llega: revisión con **solo** el `ADD COLUMN`; backfill en `python -m scripts.backfill_message_origin` (dry-run salvo `--apply`, por lotes, `SET LOCAL lock_timeout`, `action_results[].message_ids` como fuente primaria y `dedupe_key` como respaldo), nunca dentro de la revisión. Añadir un test que prohíba `UPDATE` sobre `wsp_messages` en revisiones nuevas.

### Riesgos
- El cruce en cliente está limitado a 200 ejecuciones por chat (`api.ts:35`): hoy inalcanzable; documentarlo.
- La clasificación por prefijo depende del formato de `dedupe_key` (`actions.py:351`): el test cruzado lo fija.
- Reagrupar por origen mueve colitas y márgenes: revisar en 360 px.
- B2 cambia contexto sin acción del usuario: solo con el guard completo y texto visible.

## 5. Decisiones que quedan para producto

Lo que el código no resuelve y nadie en el debate pudo cerrar.

1. **Cuándo recarga B2.** Experiencia de usuario sostiene que cambiar de chat es el instante de mayor intención y la recarga rompe la respuesta inmediata. Interfaz y segundo plano la quieren ahí porque una vendedora casi nunca sale de `/chat/*` en su jornada y la actualización no se aplicaría. Opciones: recargar al cambiar de chat con "Actualizando…" visible, o solo al salir del área de chat aceptando que B2 se aplique poco.
2. **Si la burbuja muestra el nombre de la persona.** Experiencia de usuario propone solo "Flujo X" y tratar el nombre como ruido. Backend, interfaz y automatizaciones quieren "Grecia" sobre el grupo. El contrato lleva `user_name`, así que es decisión de pantalla y de equipo.
3. **Confirmación antes de lanzar un flujo** cuyo primer envío ocurre antes de la primera espera. Evita un envío irreversible con un toque, pero castiga a quien lanza decenas al día. No hay evidencia de que hubiera evitado el incidente. Medir antes de decidir.
4. **Mover `FlowPicker` a la cabecera.** Resuelve la adyacencia y los 44 px táctiles, pero cambia un gesto aprendido. Prueba moderada.
5. **Columna tipada en fase 2.** Backend la quiere como contrato definitivo porque derivar de `dedupe_key` para siempre es frágil. Automatizaciones y segundo plano la consideran innecesaria mientras el outbox no se purgue. Se decide con datos tras A.

## 6. Hallazgo lateral del debate

`scripts/deploy-bluegreen.sh` sale por `set -e` si `migrate` falla, pero solo baja el color destino en el fallo de salud (`:221`): una migración fallida puede dejar un color en crash-loop. Conviene añadir ese `down`. Es independiente de esta propuesta.
