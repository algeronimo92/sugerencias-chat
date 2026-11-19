# 17 · Plan: llamadas de voz por la API oficial de WhatsApp (Calling API)

Fecha: 2026-11-18 · Actualizado: 2026-11-19 (decisiones de producto, detalle por fase y revisión de arquitectura) · Estado: **propuesto, sin implementar** · Origen: pedido de producto ("que el equipo pueda atender y hacer llamadas de WhatsApp desde el CRM").

Fuentes: la documentación de Meta leída el 2026-11-18 (`developers.facebook.com/documentation/business-messaging/whatsapp/calling/*`: overview, call-settings, user-initiated-calls, business-initiated-calls, user-call-permissions, sip, reference, faq, pricing; y `embedded-signup/onboarding-business-app-users` para coexistencia) y el código del repo a esa fecha. Lo que no se pudo verificar está marcado.

## Estado de la implementación (2026-11-19)

Rama `claude/pensive-einstein-2ib7jn`. Nada se probó todavía contra Meta real: la app de prueba de Meta no entrega los avisos de llamadas mientras esté sin publicar, y la fase 0 quedó pendiente.

| Fase | Hecho | Pendiente |
|---|---|---|
| 0 · Viabilidad | Kit de prueba armado | Correrlo con Meta: las nueve preguntas siguen abiertas |
| 1 · Estado y permiso | Completa. El estado vive en `platform` (administración de la cuenta), no en `conversations` | Texto de los pasos para mudar el número; validar el aviso con gente de la clínica |
| 2 · Recibir llamadas | Tabla y fusión de leads; carril propio del webhook; atender, ignorar, colgar y ciclo de limpieza; catálogo de causas; pantalla de llamada entrante y activa (computadora y celular) y tarjeta en el hilo; preparación del dispositivo; notificación de llamada perdida (campanita y push) y push de timbre persistente; chat sin leer por llamada perdida; activar y horario desde Integraciones; métricas de demora y de códigos desconocidos | Que la llamada renueve la ventana de 24 h (espera la pregunta h de la fase 0); vigencia del push (está en otra rama); alertas sobre las métricas; aviso al quitar el último agente. El filtro "Llamadas por devolver" no se hizo: la perdida ya deja el chat sin leer y entra en la vista "No leídos" |
| 3 · Llamar | Botón Llamar con el estado del permiso según Meta; llamada saliente con sus resultados (contestó, rechazó, no contestó, Meta no la dejó salir); la respuesta del cliente al permiso se lee en el chat | Pedir el permiso desde el propio botón (hoy se envía desde el menú de adjuntar); aviso "si no contesta dos veces más pierdes el permiso"; botón "Llámanos" en mensajes y plantillas |
| 4 · Medición | Pestaña Llamadas del dashboard: atención, por hora, perdidas por causa con las que faltan devolver, fallidas por causa con quién las resuelve, concentración por persona y aviso de problemas de la cuenta | Llamadas en el panel de costos y en la exportación a Excel; comparación con el período anterior; aviso cuando baja la tasa de atención; notificación a las admins cuando Meta pausa las llamadas |

Opciones que quedaron abiertas en el código hasta probar con Meta: `pre_accept` (parámetro al atender) y el rol de la conexión de audio (`localStorage` `calls.dtlsRole` y `calls.preAccept` en el navegador).

Cómo leerlo: §1–§3 son el qué y el porqué; §4 es el diseño; §4.9 es cómo se registran los fallos y sus causas y la fase 4 de §5 cómo se muestran en el dashboard; §5 es el detalle de cada fase (trabajo, pantallas, criterios de usabilidad y pruebas); §8 es la revisión de arquitectura y backend, con lo que cambió en el plan a raíz de ella.

## 1. Qué se quiere y qué ofrece Meta

La Calling API es parte de la Cloud API desde julio de 2025. Permite que el número de WhatsApp del negocio **reciba** llamadas de voz de sus clientes y **llame** a quienes dieron permiso, sin pasar por la red telefónica. Solo voz: el video figura como "planeado" y no tiene API.

| | Llamada del cliente al negocio | Llamada del negocio al cliente |
|---|---|---|
| Costo | Gratis | Por duración, en pulsos de 6 s, según el país del cliente. Perú ≈ USD 0,012/min (**cifra de fuentes secundarias, sin verificar** en la tarifa oficial) |
| Permiso del cliente | No hace falta | Debe haberlo dado (temporal 7 días o permanente) |
| Límites | — | 100 llamadas conectadas por día; 1 pedido de permiso cada 24 h y 2 cada 7 días por cliente; 4 llamadas seguidas sin contestar revocan el permiso |
| Efecto en la ventana de 24 h | La abre o renueva | La abre o renueva cuando el cliente contesta |

Lo que hace Meta y lo que queda del lado del CRM:

- **Señalización**: Meta avisa por webhook (campo `calls`) y el negocio responde por Graph API (`POST /{phone-number-id}/calls` con `connect`, `pre_accept`, `accept`, `reject`, `terminate`).
- **Audio**: WebRTC (ICE + DTLS-SRTP, Opus). El negocio pone el otro extremo. Meta contempla de forma explícita que ese extremo sea el dispositivo del agente.
- **No hay**: transferencia entre agentes, renegociación de la llamada, llamadas grupales ni salida a la red telefónica (los términos la prohíben).

## 2. Requisitos previos (ninguno es código)

| Requisito | Detalle | Estado |
|---|---|---|
| **El número no puede estar en coexistencia** | Meta exige que el número esté en Cloud API "y no en la app de WhatsApp Business"; su tabla de coexistencia dice "llamadas de voz y video: no soportadas" por Cloud API | **DermicaPro está en coexistencia.** No se puede activar hasta mudar el número (§2.1) |
| Límite de mensajería ≥ 2000 | Con el límite inicial de 250 Meta rechaza la activación (error `138015`) | OK: DermicaPro está en 2000 (visto en WhatsApp Manager el 2026-11-19) |
| Método de pago en la WABA | Aunque solo se reciban llamadas | Ya existe (se pagan plantillas) |
| La app de Meta suscrita al campo `calls` | Una casilla en el panel de la app CliniVentas, una vez para toda la plataforma | Falta. **Se marca recién al desplegar la fase 2**: antes, producción recibiría esos eventos y los descartaría como campo sin handler. La fase 0 usa una app de Meta de prueba aparte |
| País | Llamar a clientes está vedado a números de EE. UU., Canadá, Egipto, Vietnam y Nigeria. Perú no está en la lista (se infiere: Meta no lo nombra) | OK |
| Cliente | Solo desde el celular (iPhone/Android). WhatsApp Web y Escritorio no pueden llamar a un negocio | Limitación a comunicar |

### 2.1 El aviso de mudanza (coexistencia)

La función se construye igual; lo que cambia es que **el CRM detecta la coexistencia y lo dice**, en vez de mostrar un interruptor que falla.

**Detección.** `GET /{phone-number-id}?fields=is_on_biz_app,platform_type`: con `is_on_biz_app = true` el número sigue en la app. Se consulta al abrir la sección y al intentar activar; no se guarda como ajuste manual.

**Dónde se ve.** En Integraciones → WhatsApp, una sección "Llamadas" con uno de estos estados:

| Estado | Qué muestra |
|---|---|
| Requiere mudar el número | Aviso destacado (no un error): "Tu número también se usa en la app de WhatsApp Business. Para atender llamadas desde el CRM hay que mudarlo para que funcione solo desde aquí". Con qué cambia y un botón para ver los pasos |
| Falta un requisito | El que falte, con su motivo (límite de mensajería, método de pago) |
| Disponible, apagado | Interruptor para activar, horario y quiénes atienden |
| Activo | Estado, horario, quiénes atienden, y las restricciones que informe Meta |

Mientras el estado sea "requiere mudar", en el chat **no aparece** el botón Llamar: un botón muerto en cada conversación solo genera preguntas a la vendedora, que no puede resolverlo. El aviso vive donde está quien decide (la admin).

**Qué tiene que decir el aviso, porque mudar no es gratis.** Hoy, en coexistencia, las llamadas ya entran al celular por la app y suenan como cualquier llamada. Al mudar el número:

- Se deja de usar la app de WhatsApp Business en ese número: se pierden ahí los grupos, los estados, las listas de difusión y las etiquetas de la app.
- Las llamadas pasan a atenderse **solo desde el CRM**, que no suena como un teléfono cuando está cerrado (§3).
- Los chats y el historial del CRM no cambian.

**Cómo se muda: sin verificar.** La doc de Meta explica cómo entrar en coexistencia y cómo desconectarse de la API desde la app, pero no describe el paso "de coexistencia a solo API". El camino habitual es eliminar la cuenta de la app en el celular y registrar el número por API, y es de una sola vía. Hay que probarlo con un número que no sea el de producción (fase 0) antes de escribir los pasos en pantalla.

## 3. Decisión de arquitectura: el navegador es el teléfono

**El extremo WebRTC es el navegador de quien atiende (computadora o celular); el backend solo retransmite la señalización.** El audio viaja directo entre el navegador y Meta.

Por qué alcanza:

- Meta usa ICE-lite y publica sus direcciones dentro del SDP. El navegador, detrás de cualquier NAT doméstico, de oficina o de datos móviles, llega solo: no hace falta STUN ni TURN propios.
- No hay "trickle": el SDP va completo, una sola vez. El backend es un cartero de dos mensajes por llamada.
- Un deploy blue-green no corta el audio de una llamada en curso: el audio no pasa por el servidor.
- No se suma ningún servicio al VPS (ni Asterisk, ni coturn, ni puertos UDP en Traefik).

Lo que se resigna:

- Transferir una llamada a otra persona, IVR ("marque 1"), bot de voz y escucha en vivo: exigen un servidor de medios. Fuera de alcance.
- Redes que bloquean UDP saliente (algunas corporativas): la llamada no conecta. Contingencia si aparece: un coturn propio con TCP/TLS. No se construye por adelantado.

**El celular, que es donde más pesa.** El CRM es una web/PWA, no una app nativa, y eso tiene un techo que conviene tener claro antes de mudar el número:

- **Con el CRM abierto y a la vista** funciona igual que en computadora: suena, se atiende, se habla.
- **Con el CRM cerrado o el celular bloqueado** no suena como una llamada. Lo que llega es una notificación push ("Llamada entrante de …"); hay que tocarla, se abre el CRM y recién ahí se atiende. Meta da entre 30 y 60 s en total.
- **Durante la llamada**, si la persona cambia de app o se apaga la pantalla, iOS puede cortar el micrófono; Android suele mantenerlo. Se pide mantener la pantalla encendida mientras dura (Wake Lock) y se recomienda audífonos: el navegador no elige entre auricular y altavoz.
- Esto se mide en la fase 0 con celulares reales, no se supone.

La alternativa SIP (Meta ↔ una central propia) se descarta: al activarla se apagan los endpoints de Graph y casi todos los webhooks de `calls`, y obliga a operar una central por negocio.

## 4. Diseño

### 4.1 Entrada: el webhook y un carril propio

Hoy el webhook guarda cada `change` en el inbox (`integrations/meta_webhook/inbox.py`) y **un solo ciclo global los procesa de a uno, en orden** (`worker.py`), incluida la descarga de adjuntos. Para una llamada no sirve: un video pesado delante en la cola la dejaría sin sonar.

Los eventos `calls` siguen entrando al mismo inbox (se conserva la firma, la deduplicación por hash y la durabilidad; `event_type` ya guarda el `field`), pero los procesa **un segundo ciclo**, `watch_meta_calls_inbox`, registrado junto al actual en `runtime.start_background`. El ciclo de mensajes los excluye.

Filtrar por tipo no alcanza: las reglas de reintento del inbox están pensadas para mensajes y a una llamada la pierden. El carril de llamadas tiene las suyas:

| Regla del inbox hoy | Problema para una llamada | En el carril de llamadas |
|---|---|---|
| Reclama tandas de 20 y las marca `processing` | Un deploy cancela el ciclo y las 19 restantes esperan 5 minutos | Reclama de a un evento y lo libera si lo cancelan |
| Lo abandonado se retoma a los 5 minutos | La llamada ya terminó | A los 15 segundos |
| Un evento fallido se reintenta enseguida, hasta 10 veces | Un corte breve de la base quema los 10 intentos en un instante y el evento se pierde | Espera creciente entre intentos, calculada desde el último |
| Una sola señal despierta al ciclo | Con dos ciclos esperando la misma, uno puede no despertar y tardar 2 s | Señal propia; el webhook hace sonar la que corresponde al tipo |
| `last_error` guarda el texto del error | Un error de validación repite su entrada: el SDP quedaría en la base | Solo el tipo de error y el lugar |

Además:

- El carril no puede bloquearse con nada lento: el handler solo escribe en la base y registra eventos. Los push salen aparte (§4.5).
- **Un `connect` viejo no hace sonar a nadie.** Si el evento entró al inbox hace más de 60 s (`received_at`, el reloj propio, no el de Meta) se registra como llamada perdida, sin timbre.
- Al terminar de procesar un evento, su SDP se borra del `payload` del inbox (la clave de deduplicación ya está guardada aparte). Las filas fallidas hoy no se purgan nunca: sin esto el SDP quedaría para siempre.

Lo que el handler tiene que tolerar:

- **Duplicados y desorden** (lo advierte Meta: `terminate` puede llegar antes que `connect`) **y dos workers a la vez** (durante el blue-green corren el azul y el verde). Reglas de §4.2.
- **Sin teléfono**: con nombre de usuario, Meta puede omitir `from`/`wa_id` y mandar solo el BSUID. `integrations/whatsapp/identity.py` ya resuelve por `wa_id` y `user_id` y crea el lead; hace falta un constructor de identidad para el evento de llamada, como los que hay para mensaje y eco. Si la identidad está en conflicto (`WhatsAppIdentityConflictError`), el evento no se reintenta sin fin: se registra y se alerta.
- **Número de avisos de cita**: sus llamadas se ignoran, como hoy sus mensajes (`_is_notice_number`), y en Meta se dejan desactivadas.
- **`terminate` que nunca llega**: un ciclo por negocio cierra lo que quedó colgado (§4.2).

En `messages` aparece además `interactive/call_permission_reply` (el cliente aceptó o rechazó que lo llamen): entra al contrato `contracts/meta_messages.json` como subtipo de entrada con su renderer. Se guarda como cualquier mensaje.

### 4.2 Dónde vive: dentro de `conversations`

**Las llamadas son una capacidad más de `conversations`, no un módulo nuevo.** La primera versión de este plan proponía un módulo `calls` aparte; la revisión (§8) mostró que la frontera estaba mal puesta. Una llamada:

- abre o renueva la ventana de 24 h, que `conversations` calcula hoy solo con mensajes;
- sube el chat en la bandeja y, si se perdió, lo deja sin leer;
- tiene que seguir al lead cuando dos fichas se fusionan (`leads/infrastructure/merge.py` solo puede tocar tablas de `automations`, `conversations`, `notifications` y `tasks`).

Con un módulo aparte, cada una de esas tres cosas pedía un puerto nuevo o ampliar `FOREIGN_TABLES`, que solo puede achicarse. Dentro de `conversations` no hace falta ninguno. Tiene precedente: las notas internas y los mensajes programados ya son capacidades de ese módulo con sus propios archivos.

```text
backend/app/modules/conversations/
├── domain/calls.py            # Call, estados y transiciones, errores
├── application/calls.py       # recibir, reclamar/atender, descartar, colgar, llamar, registrar fin
├── application/ports.py       # + CallStore; CallControl llega por el canal
├── infrastructure/sql_calls.py
├── ports/calls_inbound.py     # lo que usa el webhook (contrato chico con __all__)
├── call_queries.py            # llamadas de un chat, las que suenan para mí, pendientes de devolver
├── calls_api.py               # /api/calls/*
├── subscribers.py             # + señalización por WebSocket
└── public.py                  # + eventos de llamada
backend/app/db/models/conversations.py   # + WhatsAppCall
backend/app/integrations/meta/calls.py   # arma y lee cuerpos; no importa el cliente
```

El costo es que `conversations`, que ya es el módulo más grande, crece. Se contiene con archivos propios y sin mezclar la máquina de estados de la llamada con la de mensajes.

**Estados.** Entrante: `ringing` → `connecting` (alguien la reclamó) → `accepted` → `completed`. Saliente: `dialing` → `ringing` → `accepted` → `completed`. Finales: `completed`, `missed`, `rejected`, `failed`.

Reglas de transición, que son lo que hace seguro el desorden y la concurrencia:

- Toda transición es un `UPDATE … WHERE status IN (…)` y **solo si cambió una fila se registra el evento**. Un duplicado no produce una segunda notificación.
- Un `connect` repetido nunca reinicia el estado: la fila se crea con `INSERT … ON CONFLICT (wa_call_id) DO NOTHING`.
- Un final es definitivo, con una excepción: lo que cerró el ciclo de limpieza (`closed_by = 'reaper'`) lo corrige el `terminate` real de Meta si llega después, porque trae la duración verdadera.
- Una sola llamada viva por chat y una sola por agente, garantizadas con índices únicos parciales sobre los estados no finales, no solo en pantalla.

**Hablar con Meta sin tocar las allowlists.** `tests/test_layering.py` solo deja importar `integrations.meta.client` a los archivos de `META_ALLOWED`, y esa lista no crece. El control de llamadas es un puerto más del canal: `CallControl` en `integrations/whatsapp/channel.py` (que la capa de aplicación ya puede importar) y `WhatsAppChannel` gana el miembro `calls`. Lo implementa `MetaCallControl` en `integrations/meta/channel.py`, que ya está en la lista; las funciones de Graph van en `meta/client.py`, con tiempo máximo de 8 s (el cliente hoy espera entre 20 y 60).

**Atender, paso a paso.** Ninguna llamada a Graph ocurre dentro de una transacción con una fila bloqueada.

1. Reclamar, transacción corta: `ringing` → `connecting`, con quién, desde qué pestaña y hasta cuándo vale el reclamo (15 s).
2. `accept` en Meta.
3. Según la respuesta:
   - **200**: `accepted`.
   - **Rechazo claro (4xx)**: si Meta dice que la llamada ya terminó, se cierra; si no, se libera y vuelve a sonar para todos.
   - **Resultado incierto (tiempo agotado, 5xx)**: Meta pudo haber aceptado. **No se libera**: soltarla dejaría que otra persona atienda una llamada ya conectada con la primera. Decide el navegador, que es quien sabe si hay audio: si conecta, confirma (`POST /api/calls/{id}/connected`); si no, a los 8 s se cuelga en Meta.
4. Si el proceso muere entre 1 y 3, el reclamo vence y el ciclo de limpieza resuelve igual que en el caso incierto.

**Llamar, paso a paso.**

1. Crear la fila en `dialing` con id propio (el índice único impide dos llamadas vivas al mismo chat).
2. `connect` en Meta con ese id en `biz_opaque_callback_data`.
3. Guardar el `wacid` que devuelve Meta.

Los webhooks pueden llegar antes del paso 3. Regla: **un evento de llamada saliente con un `wacid` desconocido nunca crea una fila**. Se enlaza por `biz_opaque_callback_data`; si no lo trae, el evento se reintenta con espera hasta que el paso 3 haya guardado el `wacid`.

**Ciclo de limpieza** (por negocio): `ringing` hace más de 2 minutos → `missed`; `connecting` con el reclamo vencido → se cuelga en Meta y `failed`; `accepted` hace más de 4 horas sin fin → `completed` sin duración. Todo marcado `closed_by = 'reaper'`.

**Eventos.** Los comandos registran eventos dentro de la unidad de trabajo (no se usa `publish`, cuya lista tampoco crece): `CallRinging`, `CallClaimed`, `CallReleased`, `CallAnswerReady`, `CallEnded` (con `outcome`). Se exportan en `conversations/public.py`.

Lo que no puede perderse va **en la misma transacción** (`Phase.TRANSACTION`); los avisos, después del commit. Los suscriptores posteriores al commit corren una sola vez y sin reintento: si el proceso muere ahí, un aviso se pierde pero el dato no.

| Efecto | Dónde | Fase |
|---|---|---|
| Subir el chat en la bandeja, abrir la conversación si estaba cerrada, marcar no leído si se perdió, mover la ventana de 24 h | El propio comando | Transacción |
| Notificación guardada de llamada perdida (una por agente) | `notifications/subscribers.py` sobre `CallEnded` | Transacción |
| Señalización por WebSocket a los agentes, `chats_updated` | `conversations/subscribers.py` | Después del commit |
| Push de timbre y de llamada perdida | `notifications/subscribers.py` | Después del commit |

**Rutas y permisos.**

| Ruta | Quién | Nota |
|---|---|---|
| `GET /api/calls/ringing` | Agentes | Las que suenan ahora |
| `GET /api/calls/{id}/offer` | Agentes, solo mientras está `ringing` | Es la única que devuelve un SDP entrante |
| `POST /api/calls/{id}/accept` · `connected` | Agentes | `connected` solo quien la reclamó |
| `POST /api/calls/{id}/dismiss` | Agentes | Deja de sonarle a esa persona; no rechaza al cliente |
| `POST /api/calls/{id}/terminate` | Quien la atiende, o admin | Nadie cuelga la llamada de otra persona. Lleva el motivo que vio el navegador, de una lista cerrada (§4.9) |
| `POST /api/calls` · `GET /api/calls/{id}/answer` | Agentes; `answer` solo quien llamó | Saliente |
| `GET /api/calls?chat_id=` | Admin y vendedor | Tarjetas del hilo; sin SDP |
| `GET /api/calls/readiness` · configuración | Admin | |

- `require_call_agent` parte de `get_current_user`: el test de rutas la reconoce por transitividad, no se toca `AUTH_GUARDS` ni `PUBLIC_ROUTES`. El analista queda fuera de todas sin hacer nada (`role_policy.py`), y al pasar un usuario a analista se le apaga el permiso.
- **Descartar no es rechazar.** Con el timbre en todos los agentes, que una persona rechace no puede cortarle al cliente. La llamada solo se rechaza en Meta cuando la descartaron todos los agentes conectados.
- El SDP se valida (tamaño máximo, empieza con `v=0`) y no se escribe en logs.

### 4.3 Datos

Dos revisiones Alembic, cada una en su PR:

- **`users.can_handle_calls`**: booleano, `NOT NULL`, con `server_default false` (durante el blue-green el color viejo sigue insertando usuarios sin conocer la columna). Al cambiarlo se invalida la caché de usuario.
- **`whatsapp_calls`**: `id`, `wa_call_id` (único, nulo hasta que Meta lo asigna), `chat_id` → `leads`, `phone_number_id`, `direction`, `status`, `closed_by`, `created_at`, `ringing_at`, `accepted_at`, `ended_at`, `duration_seconds`, `handled_by_user_id`, `claimed_by_client_id`, `claim_expires_at`, `dismissed_by` (ids de agentes), `cause` (la causa del catálogo de §4.9), `error_code` (el código literal de Meta, si lo hubo), `remote_sdp` (se borra al terminar), `events` (JSONB con cada webhook, sin el SDP). Índices: por `(chat_id, ringing_at)`, y únicos parciales sobre las no terminadas por `chat_id` y por `handled_by_user_id`. **Sin audio ni transcripción: las llamadas no se graban.**

Decisiones:

- **No hay tabla de permisos del cliente.** La verdad vive en Meta, que además no avisa cuando un permiso temporal vence: una copia en la base estaría mal justo cuando importa. El botón Llamar consulta `GET /{phone-number-id}/call_permissions` al abrir el chat (solo agentes, límite de Meta 100/s) y la respuesta del cliente queda en el hilo como mensaje.
- **No se crea una tarea automática por llamada perdida.** `lead_tasks` exige responsable y creador (`NOT NULL`), y una llamada de un número nuevo no tiene vendedora asignada. "Pendiente de devolver" es un dato derivado: una llamada perdida sin una llamada conectada ni un mensaje enviado después. No se desincroniza ni se duplica, y se resuelve sola al responder.
- **La fusión de leads** suma `whatsapp_calls` a `_OWNED_BY_LEAD` en `leads/infrastructure/merge.py`. Sin eso, las llamadas del lead de origen se borran por cascada. Es el camino normal de quien llamó solo con nombre de usuario y después se le conoce el número.
- **La ventana de 24 h** pasa a ser el más reciente entre el último mensaje del cliente y la última llamada que la abra (`conversations/chat_queries.py`). Qué llamadas la abren exactamente se confirma en la fase 0.
- Las llamadas **no** van a `wsp_messages`: esa tabla guarda el tipo literal de los mensajes de Meta. El frontend pide las del chat a `/api/calls` y las intercala en el hilo como un tipo de ítem más, junto a `activity`, `note` y `flow`.
- **Retención**: `events` se vacía a los 30 días; queda el registro de la llamada.
- `call_queries.py` no une `users` ni `leads` en la lista de llamadas: los nombres salen de los contratos públicos de `auth` y `leads`.

### 4.4 Señalización hacia el navegador

`manager.send_to_user` ya entrega a todas las pestañas de un usuario, en cualquier réplica y sin cruzar negocios. Eventos nuevos en `realtime/events.py`: `call_incoming`, `call_updated`, `call_ended`.

- **Los eventos nunca llevan el SDP.** El bus entre procesos viaja por `NOTIFY` de PostgreSQL y lo que pasa de 7500 bytes se entrega solo en el proceso local (`db/signals.py`). El evento avisa y la pestaña pide el SDP por HTTP.
- **A quién**: a cada usuario activo con `can_handle_calls`, leído de la base en el momento. No es un `broadcast` al negocio.
- **El WebSocket no es garantía y el plan no depende de él.** Un `NOTIFY` que falla se registra y se descarta; la conexión que escucha puede quedar sorda unos 20 s sin que el socket del navegador se cierre, así que "releer al reconectar" no se dispara. Por eso los agentes, con la app a la vista, consultan `GET /api/calls/ringing` cada 10 s. Con 30–60 s de timbre, eso asegura que suene aunque el tiempo real falle.
- **Al abrir la app** (por ejemplo desde una notificación) se hace la misma consulta de inmediato.

**Llamada entrante**

1. Webhook `connect` (con la oferta SDP) → llamada en `ringing`.
2. `call_incoming` a los agentes conectados; push de timbre a todos los agentes.
3. Alguien pulsa Atender → el navegador pide el micrófono, lee la oferta, arma la respuesta, espera a reunir candidatos y la manda con el `client_id` de la pestaña.
4. El backend reclama, llama a Meta y confirma (§4.2). La primera persona gana; las demás reciben `call_updated` ("la atendió Fulana") y dejan de sonar.
5. Con el 200 de Meta el audio fluye.
6. Cuelga el cliente o quien atiende → `terminate` → webhook con `duration` → tarjeta en el hilo.
7. Nadie atiende → `terminate` sin duración → llamada perdida (§4.5).

**Llamada saliente**

1. Botón Llamar (solo agentes) → el backend consulta en Meta si el cliente dio permiso.
2. Sin permiso → se ofrece mandar el pedido (el mensaje interactivo **ya existe**: `call_permission_request` en `integrations/meta/outbound.py`). Fuera de la ventana de 24 h hace falta una plantilla con el componente de permiso.
3. Con permiso → el navegador arma la oferta (`POST /api/calls`) → `dialing` → Meta `connect`.
4. Webhooks: `RINGING` / `ACCEPTED` / `REJECTED` y `connect` con la respuesta SDP → `call_updated`; la pestaña que llamó pide la respuesta por HTTP. Mientras está "conectando", también reconsulta cada 2 s.

### 4.5 Notificaciones (timbre y llamada perdida)

| Momento | En la app abierta | Campanita | Push (app cerrada o en segundo plano) |
|---|---|---|---|
| Está sonando | Pantalla o aviso de llamada entrante con timbre | — | "Llamada entrante de {nombre}". Persistente, con vibración; al tocarla abre el CRM en la llamada |
| La atendió otra persona | El aviso se cierra con "La atendió {nombre}" | — | La notificación de timbre se reemplaza por "La atendió {nombre}" |
| **Se perdió** | Aviso "Llamada perdida de {nombre}" con Abrir chat | **Notificación guardada** `missed_call`, con enlace al chat | La notificación de timbre se reemplaza por **"Llamada perdida de {nombre}"**; al tocarla abre el chat |

Además, la llamada perdida deja la tarjeta en el hilo, el chat sin leer con "Llamada perdida" como vista previa, y aparece en el filtro "Llamadas por devolver" de la bandeja.

Lo que hay que cambiar en lo que existe:

- `NotificationType.MISSED_CALL` y su ícono en el centro de notificaciones. Una por agente, creada en la transacción que cierra la llamada; se marca leída al abrir el chat, como las menciones.
- **El push de timbre y el de cierre comparten `tag`** (`call-{id}`) y cabecera `Topic`: el segundo reemplaza al primero en vez de apilarse. Como el orden de entrega no está garantizado, el service worker no deja que un timbre tardío pise un cierre: mira la notificación que ya hay con ese tag.
- `push-sw.js` hoy muestra todas las notificaciones igual. Para el timbre necesita `requireInteraction`, `renotify` y patrón de vibración; el payload gana un campo `kind`.
- **`send_push_to_user` hoy manda sin vigencia y sin tiempo máximo.** `pywebpush` 2.0.0 usa `ttl=0` por defecto ("entregar ahora o descartar") y `timeout=None`. El timbre va con vigencia de 45 s y urgencia alta; la llamada perdida con 24 h; todos con tiempo máximo de 5 s. Esto afecta a las notificaciones que ya existen y se sugiere corregir aparte (§8).
- **Los push de una llamada salen fuera del carril del webhook y en paralelo acotado.** Hoy salen de a uno y en línea. No hay en el repo un mecanismo para tareas sueltas: se agrega un despachador con tareas rastreadas que se vacía al apagar (`stop_background`), con un tope de envíos simultáneos para no agotar los hilos que también usan los adjuntos.
- **A verificar en la fase 0:** el service worker no muestra nada si hay una pestaña con foco. iOS exige que cada push muestre una notificación y da de baja la suscripción si no; con llamadas eso pasaría más seguido.

### 4.6 Frontend

Feature nueva `features/calls`, capa 6 de `FEATURE_LAYERS` (debajo de `chats`, que le pone el botón y la tarjeta; encima de `leads`). Hay que sumar la clave al mapa. `notifications` (capa 8) ya puede mostrar el tipo nuevo.

- `domain/callSession.ts`: la máquina de estados de la sesión como función pura (`idle → ringing → connecting → active → ended`, con sus errores). Es lo que más se prueba.
- `hooks/useCallSession.ts`: envuelve `RTCPeerConnection` y el micrófono. Vive en un proveedor montado por `app/` (por el `index` de la feature): cambiar de pantalla no corta el audio.
- Componentes, todos bajo las 400 líneas: `IncomingCall`, `ActiveCall`, `CallButton`, `CallCard`, `CallsSettings`, `CallReadiness`. `ChatWorkspace` ya está en `KNOWN_LARGE_COMPONENTS` y no puede crecer: solo recibe `<CallButton />`.
- `realtime.ts` con los handlers y la clave a releer al reconectar; `api.ts`, `keys.ts`; tipos regenerados en `schema.d.ts` en el mismo PR.

El micrófono ya se usa para notas de voz (`shared/ui/VoiceRecorder.tsx`) y la app no tiene una `Permissions-Policy` que lo bloquee (solo la landing).

### 4.7 Configuración del negocio

Todo en Integraciones → WhatsApp → Llamadas, solo admin:

- **Activar o desactivar** (`POST /{phone-number-id}/settings`), con los estados y el aviso de mudanza de §2.1.
- **Quiénes atienden**: lista de usuarios con un interruptor cada uno. El mismo interruptor aparece en la ficha del usuario. El rol analista no puede tenerlo. Si nadie lo tiene, la función no se deja activar.
- **Botón de llamar visible para todos los clientes** (`call_icon_visibility: DEFAULT`). No se expone como opción.
- **Horario de atención de llamadas**, en la zona horaria del negocio: fuera de horario el cliente no puede llamar. Obligatorio al activar: con el botón a la vista de todos, cada llamada que nadie atiende baja la tasa de atención, y Meta **oculta el botón** cuando es baja.
- **Devolver llamadas sin pedir permiso** (`callback_permission_status`), encendido por defecto: quien llamó puede ser llamado de vuelta durante 7 días.

`meta_call_permission_enabled` sigue siendo un valor guardado (el envío lo lee de forma síncrona), pero deja de ser un interruptor manual: lo escribe el CRM al activar o desactivar las llamadas.

### 4.8 Operación

- **Métricas**: segundos del evento `connect` en el inbox al aviso (alerta si el p95 pasa de 3 s); antigüedad del evento `calls` más viejo sin procesar (hoy el inbox no tiene ninguna métrica de cola); eventos que agotaron sus intentos; llamadas por resultado; llamadas atascadas en `connecting`; cierres hechos por el ciclo de limpieza; fallos de Graph por código; fallos de push; llamadas que sonaron sin ningún agente conectado.
- **Registros** con el `wacid` en cada línea, para seguir una llamada de punta a punta. Nunca el SDP.
- **Apagado**: por negocio, desactivar las llamadas en Meta; para toda la plataforma, una variable que detiene el carril.
- `conversations.subscribers` ya está en la lista manual de suscriptores de `composition.py`; un módulo nuevo habría tenido que acordarse de sumarse, y ningún test lo detecta.

### 4.9 Fallos y sus causas

Para poder mostrar en el dashboard qué falló y por qué, la causa se guarda **cuando ocurre**, con un vocabulario propio y cerrado. No se reconstruye después a partir de textos de error.

**Perdida no es fallida.** Son dos cosas distintas y se muestran por separado:

- **Perdida**: el cliente llamó y nadie habló con él. Es un resultado de la operación; se arregla con horario y gente.
- **Fallida**: alguien quiso atender o llamar y algo lo impidió. Es un problema técnico o de la cuenta.

**De dónde sale la causa.** Hay tres fuentes y ninguna alcanza sola:

| Fuente | Qué sabe | Ejemplo |
|---|---|---|
| Meta (`errors[].code` del webhook o de la respuesta de Graph) | Lo que pasó de su lado | `138021`, no recibió audio |
| El navegador de quien atiende | Lo que Meta no ve | Micrófono bloqueado, se cayó la red |
| El backend | Lo que pasó entre los dos | El aviso llegó tarde, Meta no confirmó, nadie conectado |

El navegador informa su motivo al colgar, eligiendo de una lista cerrada (nunca texto libre). El backend traduce los códigos de Meta con un catálogo en el dominio (`conversations/domain/calls.py`).

**Catálogo.** Cada causa tiene un nombre en lenguaje del negocio, quién puede resolverla y qué hacer. Esas tres cosas son lo que se muestra.

| Grupo (quién lo resuelve) | Causa | Origen | Qué hacer |
|---|---|---|---|
| **Equipo** (perdidas) | Sonó y nadie atendió | Backend | Revisar horario y quiénes atienden |
| | No había nadie conectado | Backend | Ídem; alguien con permiso debe tener el CRM abierto |
| | Todos la ignoraron | Backend | — |
| | El cliente colgó enseguida (menos de 5 s) | Backend | Nada: no cuenta contra la tasa de atención del equipo |
| **Dispositivo o red** de quien atiende | Micrófono bloqueado o sin micrófono | Navegador | Preparar el dispositivo (fase 2) |
| | No conectó el audio | Meta `138004`, `138019`, `138020`, `138021`, `138022`, `138023`; navegador | Probar otra red; si se repite en una persona, es su equipo |
| | Se cortó en medio de la llamada | Navegador | Ídem |
| **Cliente** (salientes) | No contestó | Meta | Recordar que 4 seguidas quitan el permiso |
| | Rechazó la llamada | Meta | — |
| | No dio permiso o ya venció | Meta `138006` | Pedir permiso |
| | No puede recibir llamadas | Meta `138001` | Escribirle |
| **Cuenta de WhatsApp** | Meta pausó las llamadas del número | Meta `138014` | Ver el motivo en WhatsApp Manager; suele ser por reportes de clientes |
| | Las llamadas no están activas o no se pueden activar | Meta `138000`, `138015`, `138018`, `138013` | Revisar la sección Llamadas en Integraciones |
| | Se alcanzó un límite (llamadas del día, pedidos de permiso, simultáneas) | Meta `138012`, `138037`, `138009`, `138005`, `138002` | Esperar; el botón ya lo avisa antes (fase 3) |
| **Sistema** (CliniVentas) | El aviso llegó tarde al CRM | Backend (`connect` con más de 60 s) | Avisar a soporte |
| | Meta no confirmó la llamada | Backend (resultado incierto, `138007`) | Avisar a soporte si se repite |
| | Cerrada sin respuesta de Meta | Backend (ciclo de limpieza) | Ídem |
| | Otro | Código desconocido | Avisar a soporte, con el código |

Reglas del catálogo, las mismas que ya usa el contrato de mensajes:

- **Un código que Meta agregue mañana no se pierde ni rompe nada**: se guarda literal en `error_code`, cae en "Otro" y dispara una métrica para que alguien lo sume al catálogo.
- **El texto en inglés de Meta nunca llega a la pantalla.** El código se muestra solo a la admin, como dato para soporte.
- Los códigos de la tabla salen de la referencia de Meta leída el 2026-11-18; se confirman contra eventos reales en la fase 0.

**Dónde se ve cada causa.**

| Lugar | Qué muestra | Para quién |
|---|---|---|
| Al momento, en la llamada | El mensaje de la tabla de errores de la fase 2 | Quien atiende |
| Tarjeta en el hilo | "Llamada fallida · no conectó el audio" | Quien abre el chat |
| Integraciones → Llamadas | Las causas del grupo "Cuenta de WhatsApp" que sigan vigentes, arriba y destacadas | Admin |
| Notificación a las admins | Solo cuando Meta pausa las llamadas del número: no puede esperar a que alguien abra el dashboard | Admin |
| Dashboard | El conjunto y la tendencia (fase 4) | Dueña, admin, analista |

## 5. Fases, en detalle

Cada fase termina cuando pasan sus pruebas **y** sus criterios de usabilidad. En todas vale lo mismo de fondo: los comandos de CI de `CLAUDE.md` en verde, `test_layering.py` y `architecture.test.ts` **sin ampliar ninguna allowlist**, y `alembic check` limpio.

### Fase 0 · Viabilidad (sin código de producto)

**Objetivo.** Saber, antes de diseñar nada, si esto funciona como se espera. Sale con respuestas escritas, no con código que se conserve.

**Trabajo.**
1. Una **app de Meta de prueba, aparte de la de producción**, con su propio webhook. La app de producción no se suscribe a `calls` todavía.
2. Un número de prueba fuera de coexistencia (Meta tiene un sandbox de llamadas) con las llamadas activadas.
3. Un script descartable (una página HTML y un servidor mínimo, fuera del repo de producto) que reciba el webhook, atienda desde el navegador y también llame.
4. Mudar un número de prueba de coexistencia a solo API y anotar cada paso.

**Preguntas que tiene que responder.**

| # | Pregunta | Por qué importa |
|---|---|---|
| a | ¿Qué rol DTLS acepta Meta (la doc muestra `actpass` y `active`)? ¿Hay que tocar el SDP que genera el navegador? | Define si el navegador sirve sin trucos |
| b | ¿Conecta sin STUN/TURN en wifi de casa, de oficina y con datos móviles? | Es la base de la decisión de §3 |
| c | ¿Hace falta `pre_accept` para que no se corten las primeras palabras? | Complejidad del flujo de atender |
| d | En iPhone (PWA instalada) y Android: ¿llega el push con el celular bloqueado?, ¿cuánto tarda de tocar la notificación a poder atender?, ¿sigue el audio al apagar la pantalla o cambiar de app?, ¿penaliza iOS un push que no muestra notificación? | Decide si conviene mudar el número |
| e | ¿Cuánto tarda el webhook `connect` desde que el cliente marca? | Cuánto queda de los 30–60 s |
| f | ¿Cómo se muda un número de coexistencia a solo API y qué se pierde? | El texto del aviso de §2.1 |
| g | ¿Cuál es la tarifa oficial de Perú? | Para no prometer costos a ojo |
| h | ¿Una llamada perdida del cliente abre la ventana de 24 h, o solo la atendida? | La regla de §4.3 |
| i | ¿`biz_opaque_callback_data` viene en todos los eventos de una llamada saliente? ¿Repetir `accept` es inocuo? | Las reglas de §4.2 para el desorden y el resultado incierto |

**Dispositivos.** Chrome, Edge, Firefox y Safari en computadora; iPhone con Safari y con la PWA instalada; Android con Chrome y con la PWA instalada.

**Listo cuando.** Las nueve respuestas están en un anexo de este documento y se confirmó o corrigió §3 y §4.2. Si (d) sale mal en iPhone, se decide con ese dato si la función se limita a computadora y Android o si se pospone la mudanza.

### Fase 1 · Estado, aviso de mudanza y permiso por usuario

**Objetivo.** La admin entra a Integraciones y entiende por qué todavía no hay llamadas y qué tiene que hacer; elige quiénes van a atender. Se puede publicar sin que exista una sola llamada.

**Backend.**
- `users.can_handle_calls` (revisión Alembic propia, con `server_default`), en el alta y edición de usuarios, con invalidación de caché; se apaga al pasar a analista; `auth.ports.users` publica la lista de agentes.
- En `meta/client.py`: lectura de `is_on_biz_app`/`platform_type` y de `settings.calling`. `CallControl.readiness()` en el canal.
- En `conversations`: `call_queries.py` (estado de la función) y `calls_api.py` con `GET /api/calls/readiness` (admin). Solo lo que esta fase usa.

**Frontend.**
- Sección "Llamadas" en la tarjeta de WhatsApp (`CallsSettings`) con los cuatro estados de §2.1.
- Interruptor "Atiende llamadas" en la ficha de usuario y en la lista de la sección.

**Diseño.**
- El aviso de mudanza usa el componente de aviso de integraciones que ya existe (`shared/ui/IntegrationNotice`), en tono informativo: no es un error ni lo causó la usuaria.
- Estructura del aviso: una frase de qué pasa, tres viñetas de qué cambia al mudar, un botón secundario "Ver los pasos". Los pasos se abren en un diálogo, no en la tarjeta.
- Estados de carga y de error propios: si Meta no responde, "No pudimos consultar el estado en Meta" con Reintentar, nunca un interruptor apagado que parezca definitivo.
- Igual en celular: la sección se apila en una columna; los interruptores con área táctil de 44 px o más.

**Usabilidad (se da por buena si).**
- Una admin que no conoce el tema puede decir, tras leer el aviso, qué tiene que hacer y qué pierde. Se valida con dos o tres personas del negocio antes de cerrar el texto.
- No aparece ninguna palabra de Meta sin traducir ("coexistencia", "Cloud API", "WABA"): se dice "tu número también se usa en la app de WhatsApp Business".
- El estado se entiende sin depender del color (ícono y texto), y se anuncia a lectores de pantalla.
- Apagar el permiso al último agente con la función activa avisa la consecuencia antes de guardar.

**Pruebas.**
- Backend (dobles): `readiness` para cada combinación (coexistencia, límite bajo, sin agentes, activo, Meta no responde); solo admin puede leerla y cambiar permisos; analista no puede recibir el permiso y lo pierde al cambiar de rol.
- Backend (Postgres real): la revisión aplica, un insert sin la columna funciona (el caso del color viejo) y `alembic check` queda limpio.
- Frontend (vitest): `CallsSettings` en sus cuatro estados más carga y error; el interruptor de usuario.
- e2e: la admin ve el aviso de mudanza en escritorio y celular; la vendedora no ve la sección.

**PRs.** (1) migración `users.can_handle_calls`; (2) backend de estado + permiso, con `schema.d.ts`; (3) frontend.

### Fase 2 · Recibir llamadas

**Objetivo.** Un cliente llama al número; a quienes tienen el permiso les suena; uno atiende, habla y cuelga; queda registrado en el chat. Si nadie atiende, queda como perdida y todos se enteran.

**Backend.**
- Revisión Alembic: `whatsapp_calls`. Y `whatsapp_calls` en `_OWNED_BY_LEAD` de la fusión de leads, en el mismo PR que el modelo.
- Carril propio del inbox con sus reglas (§4.1).
- Dominio, comandos, repositorio, `CallControl` y su adaptador de Meta (`accept`, `reject`, `terminate`).
- Handler `calls` en el webhook, constructor de identidad para llamadas y traducción en `integrations/meta/calls.py`.
- Efectos en la bandeja y en la ventana de 24 h (§4.2, §4.3); filtro "Llamadas por devolver".
- Rutas de §4.2 (menos las salientes).
- Notificaciones de §4.5: tipo `missed_call`, push con vigencia, urgencia y tiempo máximo, despachador de push, cambios del service worker.
- Ciclo de limpieza.
- Catálogo de causas y su registro en cada cierre (§4.9); aviso a las admins cuando Meta pausa las llamadas.
- Configuración: activar, horario, devolución sin permiso (`POST settings`).
- Operación (§4.8): métricas, alertas, interruptor del carril.
- Suscribir la app de producción a `calls`, al desplegar.

**Frontend.**
- `callSession` (dominio), `useCallSession`, proveedor en `app/`, consulta periódica de las que suenan.
- `IncomingCall`, `ActiveCall`, `CallCard` en el hilo; vista previa y filtro de perdidas en la bandeja.
- `CallReadiness`: la preparación del dispositivo (ver Usabilidad).
- Horario y activación en `CallsSettings`.
- Ícono y texto de `missed_call` en el centro de notificaciones.

**Diseño: pantallas y estados.**

*Llamada entrante.*
- Computadora: aviso flotante arriba a la derecha, por encima de cualquier diálogo, que no tapa el chat abierto. Nombre del lead (o número si no tiene), etapa y vendedora asignada, y dos botones: **Atender** (primario) e **Ignorar**. Se dice "Ignorar" y no "Rechazar" porque no le corta al cliente: solo deja de sonarle a esa persona.
- Celular: pantalla completa. Nombre grande, botones de 64 px separados entre sí, en la mitad inferior, al alcance del pulgar.
- Timbre en bucle hasta que se resuelve; se corta al instante si otra persona atiende.
- Si quien recibe ya está en una llamada: aviso sin sonido ("Otra llamada: {nombre}"), sin botón Atender.

*Conectando.* Entre pulsar Atender y oír al cliente: "Conectando…" con los botones deshabilitados. Si pasa de 8 s, "No se pudo conectar" y se cierra.

*Llamada activa.*
- Computadora: barra fija abajo con nombre, cronómetro, Silenciar, selector de micrófono y Colgar. Navegar por el CRM no la quita.
- Celular: pantalla propia con Silenciar, Altavoz si el dispositivo lo permite y Colgar; se puede minimizar a una barra superior para ver el chat mientras se habla.
- Silenciado se nota siempre (ícono y texto "Micrófono apagado").
- Señal de mala conexión cuando el audio se degrada: "Conexión inestable".

*Fin.* "Llamada terminada · 3:42" por 3 s y vuelve al chat de ese lead con el cursor en el redactor.

*Tarjeta en el hilo.* Centrada, como el cambio de etapa. "Llamada entrante · 3:42 · atendió Ana" / "Llamada perdida · 10:15". La perdida en el color de alerta, con ícono propio, y con el botón Devolver llamada cuando exista la fase 3.

*Errores, cada uno con su texto y su salida.*

| Qué pasó | Qué ve | Qué puede hacer |
|---|---|---|
| Micrófono bloqueado | "El navegador no tiene permiso para usar el micrófono" con cómo habilitarlo | La llamada sigue sonando para los demás |
| Otra persona atendió primero | "La atendió Ana" | Se cierra solo |
| El cliente colgó antes | "El cliente colgó" | Abrir chat |
| No conectó el audio | "No se pudo conectar el audio. Puede ser la red" | Abrir chat para escribirle |
| Meta rechazó la operación | Mensaje humano por código; el código queda en el registro, no en pantalla | Abrir chat |
| Se cayó la conexión en medio | "Se cortó la llamada" | Abrir chat |

**Usabilidad (se da por buena si).**
- **Preparación antes de la primera llamada.** Al recibir el permiso (y en cada dispositivo nuevo) el usuario ve una vez "Prepara este dispositivo para llamadas": conceder micrófono, activar notificaciones y una prueba de sonido. Sin esto, la primera llamada real se pierde detrás del cuadro de permisos del navegador, y el timbre no suena porque el navegador bloquea el audio sin una interacción previa.
- Atender es un solo toque. Colgar también, sin confirmación.
- De que suena a que se oye al cliente: menos de 3 s en computadora con la app abierta.
- En celular, de tocar la notificación a ver el botón Atender: lo que mida la fase 0, con una meta de menos de 6 s.
- Toda la llamada se maneja con teclado; el aviso entrante no roba lo que se estaba escribiendo (el borrador del redactor se conserva: ya existe `draftStore`).
- Los cambios de estado se anuncian a lectores de pantalla; los botones tienen nombre accesible; contraste AA en claro y oscuro.
- La pantalla no se apaga durante la llamada en celular.
- Vocabulario único en toda la app: "llamada perdida", "atender", "ignorar", "colgar", "devolver la llamada".

**Pruebas.**

*Backend, con dobles.*
- Máquina de estados, por tabla: todos los órdenes de eventos, incluidos `terminate` antes de `connect`, `connect` duplicado sobre una llamada ya reclamada, un `ringing` tardío sobre una cerrada, y el `terminate` de Meta sobre un cierre del ciclo de limpieza.
- Un evento duplicado no produce una segunda notificación.
- Traducción del webhook con fixtures nuevos en `tests/fixtures/meta/` (`calls_connect`, `calls_terminate_completed`, `calls_terminate_missed`, sin `from` y con BSUID, del número de avisos).
- `connect` con más de 60 s en el inbox no hace sonar.
- Atender: reclamo ganado; reclamo perdido (409 con quién atendió); Meta rechaza y se libera; Meta dice que ya terminó; **Meta no responde y no se libera**; el navegador confirma; el navegador no confirma y se cuelga.
- Permisos de cada ruta de la tabla de §4.2: sin permiso 403, analista 403, colgar la llamada de otra persona 403, la oferta deja de servirse cuando ya no está sonando, un negocio no ve llamadas de otro.
- Ignorar: no toca Meta; cuando ignoran todos los conectados, rechaza.
- Bandeja y ventana: una llamada sube el chat, la perdida lo deja sin leer, un lead nuevo queda con la conversación abierta, la ventana de 24 h se mueve.
- Notificaciones: la perdida crea una `missed_call` por agente dentro de la transacción y un push con el mismo `tag` que el timbre; la atendida no crea notificación guardada.
- Fusión de leads: las llamadas del origen quedan en el destino.
- Catálogo de causas, por tabla: cada código de Meta listado en §4.9 da su causa; un código desconocido da "Otro", conserva el código y suma a la métrica; el motivo del navegador solo acepta valores de la lista.
- Cada forma de terminar una llamada deja una causa: ninguna llamada perdida o fallida queda sin ella.
- El SDP no aparece en logs, en `events`, en `last_error` ni queda en el inbox tras procesar.
- Adaptador de Meta con el doble de transporte que ya usa `test_meta_client.py`.

*Backend, contra PostgreSQL real.*
- Dos `accept` simultáneos: exactamente uno gana.
- Dos workers procesando eventos de la misma llamada a la vez: un solo registro, estado final correcto, una sola notificación.
- Un agente no puede quedar con dos llamadas vivas.
- El carril de llamadas no toma mensajes ni el de mensajes toma llamadas; un mensaje lento no retrasa una llamada.
- Un evento reclamado y cancelado vuelve a estar disponible enseguida; un fallo repetido espera entre intentos.
- El ciclo de limpieza cierra lo colgado, no toca lo vigente y no pisa un cierre de Meta.

*Frontend (vitest).*
- `callSession` por tabla de transiciones.
- `useCallSession` con `RTCPeerConnection` y `getUserMedia` falsos (en `test/setup.ts`): atender, micrófono denegado, fallo de conexión, colgar, silenciar.
- `IncomingCall` y `ActiveCall` en cada estado; "la atendió otra persona"; segunda llamada estando en una.
- Handlers de tiempo real, relectura al reconectar y la consulta periódica (suena aunque no llegue el evento).
- `CallCard` (incluida la fallida con su causa) y la notificación `missed_call`.

*e2e (Playwright, backend y WebSocket simulados, escritorio y celular).*
- Suena, se atiende, se cuelga y aparece la tarjeta (con `RTCPeerConnection` sustituido y audio falso del navegador).
- Suena y otra persona atiende.
- Llamada perdida: aviso, campanita, tarjeta, chat sin leer y filtro.
- Abrir la app con una llamada ya sonando (el camino de la notificación).
- Usuario sin permiso: no le suena ni ve controles.

*Con Meta de verdad (manual, fuera de CI), en la matriz de dispositivos de la fase 0.* Lista fija: atender, ignorar, colgar de cada lado, dejar sonar hasta perder, dos personas atendiendo a la vez, llamada durante un deploy, app cerrada en celular, wifi → datos en medio de la llamada.

**PRs.** (1) migración y fusión de leads; (2) carril del inbox; (3) push con vigencia y despachador; (4) dominio, comandos, adaptador y webhook; (5) notificaciones de llamada y service worker; (6) frontend de llamada; (7) configuración y horario; (8) métricas y alertas. El (2) y el (3) mejoran lo que ya existe aunque el resto se atrase.

**Listo cuando.** Todo lo anterior pasa y la lista manual se completó en al menos una computadora, un iPhone y un Android.

### Fase 3 · Llamar al cliente

**Objetivo.** Desde el chat, un agente llama a un cliente que dio permiso, o le pide el permiso; devuelve una llamada perdida con un toque.

**Backend.**
- `call_permission_reply` en el contrato de mensajes y su renderer; al llegar, `chats_updated` para que el botón se actualice.
- Comando de llamar (`dialing` → `connect`, §4.2), estados `RINGING`/`ACCEPTED`/`REJECTED` y `connect` con la respuesta SDP.
- Consulta de permiso y de límites a Meta (`call_permissions`).
- Rutas: `POST /api/calls`, `GET /api/calls/{id}/answer`, `GET /api/calls/permission?chat_id=`.
- Botón "Llámanos" (`interactive/voice_call`) como salida nueva del contrato, y soporte del botón `VOICE_CALL` en plantillas, que hoy la importación marca como no soportado.

**Frontend.**
- `CallButton` en el encabezado del chat y en la tarjeta de llamada perdida.
- Estado "Llamando…" con Cancelar; renderer de la respuesta del permiso en el hilo.
- "Llámanos" en el diálogo de interactivos que ya existe.

**Diseño: el botón dice qué va a pasar antes de tocarlo.**

| Situación | Botón | Al tocarlo |
|---|---|---|
| El cliente dio permiso | "Llamar" (activo) + "Con permiso hasta el 25 nov" | Llama |
| Llamó hace menos de 7 días | "Devolver llamada" | Llama |
| Sin permiso, se puede pedir | "Pedir permiso para llamar" | Muestra el mensaje que se va a enviar y lo manda |
| Sin permiso, fuera de la ventana de 24 h | "Pedir permiso" → plantilla | Abre el envío de plantilla con la de permiso |
| Ya se pidió hoy / dos veces esta semana | Deshabilitado + "Podrás volver a pedirlo el martes" | — |
| Límite diario de llamadas alcanzado | Deshabilitado + "Se alcanzó el límite de llamadas de hoy" | — |
| Meta no responde | "No se pudo consultar el permiso" + Reintentar | — |
| Función inactiva o usuario sin permiso | No se muestra | — |

- "Llamando…" muestra lo que Meta informa: "Sonando en su teléfono", "Contestó", "No contestó", "Rechazó la llamada".
- **Aviso antes de perder el permiso**: tras dos llamadas seguidas sin contestar, "Si no contesta dos veces más, perderás el permiso para llamarle".
- La respuesta del cliente al permiso aparece en el hilo ("Aceptó que le llamen · hasta el 25 nov" / "No aceptó llamadas") y habilita el botón sin recargar.

**Usabilidad (se da por buena si).**
- Nunca se llega a un error de Meta por algo que el botón podía saber: cada rechazo previsible se muestra antes como estado del botón.
- Las fechas se dicen como fechas ("hasta el 25 nov"), no como plazos ("7 días").
- Llamar es un toque; no hay confirmación previa, pero Cancelar está disponible desde el primer instante.
- Las llamadas a clientes se cobran: la sección de configuración lo dice una vez, con la tarifa verificada en la fase 0; no se interrumpe cada llamada con el costo.

**Pruebas.**
- Backend (dobles): cada fila de la tabla del botón sale de `GET permission`; llamar sin permiso no llega a Meta; un evento con `wacid` desconocido no crea una fila y se enlaza por el id propio; `REJECTED` y sin respuesta cierran bien; fixtures `calls_status_*`, `calls_connect_answer`, `call_permission_reply_*`.
- Backend (Postgres real): dos pestañas llaman al mismo lead a la vez → una sola llamada, la otra recibe un conflicto.
- Contrato: `test_meta_contract.py` y `metaContract.ts` regenerado con `python -m scripts.export_meta_contract`.
- Frontend (vitest): `CallButton` en cada fila de la tabla; flujo saliente en `callSession`; renderer del permiso.
- e2e: pedir permiso → llega la respuesta → llamar → colgar; devolver una perdida desde su tarjeta.
- Con Meta de verdad: permiso temporal y permanente, rechazo, sin respuesta, límite de pedidos.

**PRs.** (1) contrato + renderer del permiso; (2) llamada saliente en backend; (3) `CallButton` y flujo saliente; (4) "Llámanos" en mensajes y plantillas.

### Fase 4 · Medición: actividad, fallos y causas

**Objetivo.** La dueña ve si las llamadas se atienden, cuánto cuestan y, **si algo falló, qué fue, cuántas veces y quién puede arreglarlo**.

**Backend.**
- Los números salen por el dashboard, no por `/api/calls`: el rol analista existe para mirar el dashboard y solo puede pedir `/api/dashboard` (`auth/role_policy.py`). Una ruta bajo `/api/calls` le daría 403.
- `conversations` publica un contrato de lectura (`ports/call_metrics.py`) y el dashboard de `leads` lo llama y suma el bloque a su respuesta, con los mismos filtros de período y de alcance (todo el negocio o una persona) que ya tiene. Las consultas del dashboard no leen la tabla de llamadas.
- Bloques: actividad (atendidas, perdidas, tasa de atención, duración media, tiempo hasta devolver una perdida, por persona y por franja horaria), perdidas por causa, fallidas por causa y por persona, y costo de las salientes en el panel de costos de Meta (`meta_costs`).
- Las llamadas entran a la exportación a Excel del dashboard, con su causa.
- Aviso a la admin cuando la tasa de atención baja de un umbral, antes de que Meta oculte el botón.

**Frontend.** Pestaña "Llamadas" en el dashboard, visible solo si el negocio tiene las llamadas activas o tuvo alguna en el período. Tarjeta resumida en la pestaña Resumen.

**Diseño.**

*Arriba: lo que requiere acción hoy.* Si hay una causa vigente del grupo "Cuenta de WhatsApp" (Meta pausó las llamadas, se alcanzó un límite), va como aviso al tope de la pestaña con qué hacer. No se deja enterrada en un gráfico.

*Actividad.* Tres números (atendidas, perdidas, tasa de atención) y la distribución por hora debajo, con el componente de horas que el dashboard ya tiene. Es la que sirve para ajustar el horario.

*Llamadas perdidas: por qué.* Barras por causa del grupo "Equipo". Las que el cliente colgó enseguida se muestran aparte y no cuentan contra la tasa de atención. Debajo, la lista de las que siguen sin devolver, con enlace al chat.

*Llamadas con fallo: causas.* Sigue el panel "Fallos" que ya existe en la pestaña de flujos, para que se lea igual:

- Si no hubo ninguna: "Ninguna llamada falló". No se muestra un gráfico vacío ni se oculta el panel: que no haya fallos es información.
- Si hubo: una barra por causa, con su nombre del catálogo, la cantidad, y una etiqueta de quién lo resuelve (Dispositivo o red, Cliente, Cuenta de WhatsApp, Sistema).
- Al tocar una causa: qué significa y qué hacer, en una frase cada cosa, y las llamadas afectadas (lead, hora, quién atendía) con enlace al chat.
- **Concentración por persona.** Cuando los fallos de audio se juntan en alguien, se dice: "9 de 11 fallos de audio fueron de Ana". Casi siempre es su equipo o su red, y es el dato que convierte un gráfico en algo que se puede arreglar.
- Comparación con el período anterior, como el resto del dashboard.

**Usabilidad (se da por buena si).**
- Una dueña puede responder, mirando la pestaña y sin ayuda: ¿falló algo?, ¿qué?, ¿lo arreglo yo, mi equipo o hay que avisar a soporte?
- **Cada causa dice qué hacer o a quién avisar.** Ninguna termina en un código.
- Perdidas y fallidas nunca se suman en un mismo número: una mezcla "23 llamadas con problemas" no dice si falta gente o falla la red.
- Los fallos se muestran con su total ("3 de 42 llamadas"). Con menos de 10 llamadas en el período no se muestran porcentajes: con tan pocas, un fallo parece una crisis.
- La causa "Otro" muestra el código a la admin y nada más; el resto de los roles ve "Otro".
- Para el analista, que no puede abrir chats, las llamadas afectadas se listan sin enlace.
- Las etiquetas de grupo no dependen del color; definición de cada métrica a un toque.
- Se revisa con el panel de debate (`debate-expertos`) antes de construirlo, como se hizo con el dashboard.

**Pruebas.**
- Backend (Postgres real, datos sembrados): cada métrica por ventana, zona horaria del negocio y llamadas que cruzan medianoche; perdidas y fallidas no se cruzan; los colgados enseguida quedan fuera de la tasa de atención; el alcance por persona; un período sin llamadas y uno sin fallos devuelven ceros, no error.
- Backend (dobles): el analista recibe el bloque por el dashboard y sigue sin poder pedir `/api/calls`; la exportación incluye la causa.
- Frontend (vitest): la pestaña sin llamadas, con llamadas y sin fallos ("Ninguna llamada falló"), con fallos de varios grupos, con una causa vigente de la cuenta (aviso arriba), con concentración en una persona, con menos de 10 llamadas (sin porcentajes), como admin (ve el código de "Otro") y como analista (sin enlaces).
- e2e: el dashboard con y sin llamadas, en escritorio y celular; tocar una causa y llegar al chat de una llamada afectada.

**PRs.** (1) contrato de métricas en `conversations` y bloque en el dashboard, con `schema.d.ts`; (2) pestaña Llamadas; (3) exportación y aviso de tasa de atención.

### Fuera de alcance

Grabación y transcripción, buzón de voz, video, transferencia, IVR, bot de voz, SIP, app nativa, tarea automática por llamada perdida, y "pausar mis llamadas" por usuario (se evalúa con datos de uso de la fase 2).

Las fases 1 a 4 se construyen y prueban con el número de prueba. **Para DermicaPro la activación real espera a que muden su número**; hasta entonces ven el aviso.

Forma de los PRs, por las convenciones del repo: cada revisión Alembic va sola; cada cambio de API regenera `schema.d.ts`; nada de traslados mezclados con contrato.

## 6. Decisiones de producto

Tomadas el 2026-11-19:

| Tema | Decisión | Dónde quedó |
|---|---|---|
| Número en coexistencia | DermicaPro lo está. El CRM lo detecta y avisa que hay que mudarlo; no se bloquea la construcción | §2.1, fase 1 |
| A quién le suena | A todos los usuarios con permiso de llamadas, configurable por la admin | §4.4, §4.7 |
| Grabación | No se graba | §4.3 |
| Dispositivo | Computadora y celular, cualquier usuario con permiso; diseño responsive | §3, fase 2 |
| Botón de llamar del cliente | Visible para todos los clientes | §4.7 |
| Notificaciones | También cuando la llamada se perdió | §4.5 |
| Errores | Se muestran en el dashboard, si los hay, con su causa | §4.9, fase 4 |

Supuestos que conviene confirmar:

1. El botón **Llamar del CRM** usa el mismo permiso por usuario que atender. Si se quiere separar "puede atender" de "puede llamar", son dos interruptores.
2. **Ignorar no le corta al cliente**; solo se rechaza la llamada cuando la ignoraron todos los agentes conectados.
3. **Solo cuelga quien atiende** (o una admin).
4. **Sin tarea automática por llamada perdida**: queda la notificación, el chat sin leer y el filtro "Llamadas por devolver".

Pendiente, y es la decisión de fondo: **si DermicaPro muda el número.** Hoy sus llamadas suenan en el celular por la app. Mudado, se atienden desde el CRM, con registro en el chat y varias personas a la vez, pero sin timbre de teléfono cuando el CRM está cerrado y sin la app (grupos, estados, difusión). La fase 0 (d) da el dato para decidirlo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Mudar el número es de una sola vía y su procedimiento no está documentado por Meta | Probarlo en la fase 0 con otro número; el aviso dice qué se pierde antes de ofrecer los pasos |
| En celular no suena con el CRM cerrado; iOS puede cortar el audio al salir de la app | Medirlo en la fase 0; push persistente con vibración; pantalla encendida durante la llamada |
| Botón visible para todos + pocas llamadas atendidas → Meta oculta el botón; reportes de clientes → pausa de 7 días | Horario obligatorio, filtro de llamadas por devolver, aviso de tasa de atención (fase 4) |
| Llamadas que no suenan por cola, bus o WebSocket | Carril propio con sus reglas, consulta periódica, push, métricas de cola |
| Meta no confirma si aceptó la llamada | No se libera; decide el navegador; el ciclo de limpieza cierra lo que quede |
| La primera llamada se pierde tras el cuadro de permisos del navegador | Preparación del dispositivo al recibir el permiso |
| Nadie con permiso conectado | Queda como perdida con notificación; no se deja activar sin agentes; métrica propia |
| El rol DTLS o un detalle del SDP no coincide con la doc | Fase 0 antes de diseñar pantallas |
| Dos personas atienden a la vez / varias pestañas | Reclamo atómico e índices únicos en la base |
| `conversations` crece demasiado | Archivos propios para llamadas; si algún día pesa, se extrae con sus puertos ya conociendo las costuras reales |
| Meta agrega o cambia códigos de error | Catálogo con "Otro" y métrica; el código literal siempre se guarda |
| Tarifa de Perú sin verificar | Fase 0 (g) |
| La doc de Meta tiene partes viejas (dice 5 llamadas/día en ejemplos; son 100) | Tratar los límites como dato que devuelve la API (`call_permissions`), no como constante |

## 8. Revisión de arquitectura y backend

Hecha el 2026-11-19 sobre la versión anterior de este documento: una pasada independiente que contrastó cada afirmación de §4 y §5 con el código, sin ejecutar nada. Los tres hallazgos graves se comprobaron después a mano en los archivos citados. Lo de abajo ya está incorporado arriba; se deja el registro de qué cambió y por qué.

### Lo que no habría funcionado

| Hallazgo | Evidencia | Cambio |
|---|---|---|
| Al fusionar dos leads, las llamadas del origen se borraban por cascada; evitarlo desde un módulo `calls` exigía ampliar `FOREIGN_TABLES` | `leads/infrastructure/merge.py` (`_OWNED_BY_LEAD`); `tests/test_layering.py` (entrada de `merge.py`) | Las llamadas pasan a `conversations` (§4.2) |
| Una llamada no movía la ventana de 24 h, no abría la conversación de un lead nuevo ni tenía de dónde sacar el indicador de la bandeja | `conversations/chat_queries.py` (`get_customer_service_window` solo mira mensajes); `identity.py` crea solo la fila del lead | Ídem; efectos en el propio comando (§4.2, §4.3) |
| La tarea "Devolver la llamada" no se podía crear sin responsable ni creador | `db/models/tasks.py`: ambos `NOT NULL` | Sin tarea automática; "por devolver" es un dato derivado (§4.3) |

Los tres tenían la misma raíz: la frontera del módulo. Corregirlos uno por uno habría sumado tres puertos entre `calls`, `leads` y `conversations`; mover la capacidad los elimina.

### Lo que habría funcionado mal

| Hallazgo | Evidencia | Cambio |
|---|---|---|
| Las reglas de reintento del inbox pierden o atrasan llamadas: tandas de 20, espera de 5 minutos, reintentos sin pausa, una sola señal | `meta_webhook/inbox.py`, `worker.py`, `db/signals.py` | Reglas propias del carril (§4.1) |
| Lo que corre después del commit se ejecuta una vez y sin reintento: la notificación de perdida podía no crearse nunca | `core/events.py`, `db/uow.py` | Lo durable, en la transacción (§4.2) |
| Un evento duplicado creaba notificaciones duplicadas | `user_notifications` no tiene clave única | Evento solo si la transición cambió una fila (§4.2) |
| Liberar la llamada cuando Meta no respondía dejaba que dos personas atendieran la misma | `meta/client.py`: sin reintento, esperas de 20–60 s | Resultado incierto: no se libera (§4.2) |
| `connecting` sin vencimiento; el cierre del ciclo de limpieza descartaba la duración real | — | Vencimiento del reclamo y `closed_by` (§4.2) |
| La carrera de la llamada saliente no estaba cerrada: un evento sin el dato de enlace creaba una segunda fila | — | Un `wacid` desconocido nunca inserta; índice único por chat (§4.2, §4.3) |
| El tiempo real puede fallar sin que el navegador lo note | `db/signals.py`: avisos descartados, conexión sorda hasta ~20 s | Consulta periódica (§4.4) |
| Push sin tiempo máximo, enviados en línea; el orden de entrega no garantiza que el cierre llegue último | `notifications/push_service.py`; `pywebpush` 2.0.0 | §4.5 |
| Faltaban permisos en las lecturas; cualquiera podía colgar o rechazar por todos | — | Tabla de rutas (§4.2) |
| Suscribir la app de producción a `calls` en la fase 0 mandaba los eventos a producción, que los descarta | `meta_webhook/processor.py` (campo sin handler) | App de prueba aparte (§2, fase 0) |
| Sin métricas de cola del inbox | `realtime/queue_metrics.py` cubre solo el outbox | §4.8 |

### Lo que la revisión confirmó

- `require_call_agent` se reconoce por transitividad y el analista queda fuera de rutas nuevas sin tocar nada (`tests/test_route_security.py`, `auth/role_policy.py`).
- `CallControl` en el canal y su adaptador en `meta/channel.py` pasan los tests sin ampliar listas.
- El ruteo del negocio por `metadata.phone_number_id` y el `event_type` del inbox sirven tal cual para `calls`.
- La clave de deduplicación cubre el evento entero: dos eventos distintos de una llamada no chocan.
- `send_to_user` no cruza negocios aunque los ids de usuario se repitan entre schemas.
- `pywebpush` 2.0.0 usa `ttl=0` por defecto (leído en su código fuente).
- La capa 6 para `features/calls` es coherente con quién importa a quién.

### Lo que sigue sin verificar (va a la fase 0)

- La forma exacta de los eventos de Meta: si `calls` trae `metadata`, si `biz_opaque_callback_data` viene en todos, los nombres de los campos de BSUID.
- Si repetir `accept` es inocuo y si se puede llamar a un cliente identificado solo por BSUID.
- Cuándo da de baja iOS una suscripción por push sin notificación.
- No se ejecutó ningún test: todo lo de esta sección sale de leer el código.

### Hallazgo aparte, que no es de llamadas

Las notificaciones push que ya existen se mandan sin vigencia (`ttl=0`: si el celular no está conectado en ese instante, el aviso se descarta) y sin tiempo máximo de espera. Conviene corregirlo aunque las llamadas no se hagan.
