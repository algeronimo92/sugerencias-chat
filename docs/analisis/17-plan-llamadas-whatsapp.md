# 17 · Plan: llamadas de voz por la API oficial de WhatsApp (Calling API)

Fecha: 2026-11-18 · Actualizado: 2026-11-19 (decisiones de producto, detalle por fase y revisión de arquitectura) · Estado: **propuesto, sin implementar** · Origen: pedido de producto ("que el equipo pueda atender y hacer llamadas de WhatsApp desde el CRM").

Fuentes: la documentación de Meta leída el 2026-11-18 (`developers.facebook.com/documentation/business-messaging/whatsapp/calling/*`: overview, call-settings, user-initiated-calls, business-initiated-calls, user-call-permissions, sip, reference, faq, pricing; y `embedded-signup/onboarding-business-app-users` para coexistencia) y el código del repo a esa fecha. Lo que no se pudo verificar está marcado.

Cómo leerlo: §1–§3 son el qué y el porqué; §4 es el diseño; §5 es el detalle de cada fase (trabajo, pantallas, criterios de usabilidad y pruebas); §8 es la revisión de arquitectura y backend, con lo que cambió en el plan a raíz de ella.

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
| Límite de mensajería ≥ 2000 | Con el límite inicial de 250 Meta rechaza la activación (error `138015`) | Confirmar en WhatsApp Manager |
| Método de pago en la WABA | Aunque solo se reciban llamadas | Ya existe (se pagan plantillas) |
| La app de Meta suscrita al campo `calls` | Una casilla en el panel de la app CliniVentas, una vez para toda la plataforma | **Falta** |
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

### 4.1 Entrada: el webhook y su latencia

Hoy el webhook guarda cada `change` en el inbox (`integrations/meta_webhook/inbox.py`) y **un solo ciclo global los procesa de a uno, en orden** (`worker.py`), incluida la descarga de adjuntos. Para una llamada no sirve: un video pesado delante en la cola la dejaría sin sonar.

- Los eventos `calls` siguen entrando al mismo inbox: se conserva la firma, la deduplicación por hash y la durabilidad. `event_type` ya guarda el `field`.
- Se procesan en **un carril propio**: un segundo ciclo (`watch_meta_calls_inbox`, registrado junto al actual en `runtime.start_background`) que reclama solo `event_type = 'calls'`; el actual los excluye. `claim_events` gana un filtro por tipo.
- El carril no puede bloquearse con nada lento: el handler solo escribe en la base y publica eventos. Los push, que hoy se mandan de a uno y en un hilo, salen en una tarea aparte (§4.5).
- **Un `connect` viejo no hace sonar a nadie.** El inbox reintenta hasta 10 veces y retoma lo abandonado a los 5 minutos; un `connect` cuyo `timestamp` tenga más de 60 s se registra como llamada perdida, sin timbre.

Lo que el handler tiene que tolerar:

- **Duplicados y desorden** (lo advierte Meta: `terminate` puede llegar antes que `connect`) **y dos workers a la vez** (durante el blue-green corren el azul y el verde, cada uno con su ciclo). La llamada se guarda con `INSERT … ON CONFLICT (wa_call_id) DO UPDATE` y las transiciones son monótonas: un estado final nunca vuelve atrás.
- **Sin teléfono**: con nombre de usuario, Meta puede omitir `from`/`wa_id` y mandar solo el BSUID. `integrations/whatsapp/identity.py` ya resuelve por `wa_id` y `user_id` y crea el lead si no existe; se reutiliza tal cual. Una llamada de un número desconocido crea su lead, igual que un mensaje.
- **Número de avisos de cita**: sus llamadas se ignoran, como hoy sus mensajes (`_is_notice_number`), y en Meta se dejan desactivadas.
- **`terminate` que nunca llega**: un ciclo por negocio cierra lo que quedó colgado (sonando hace más de 2 minutos → perdida; en curso hace más de 4 horas → terminada sin duración).

En `messages` aparece además `interactive/call_permission_reply` (el cliente aceptó o rechazó que lo llamen): entra al contrato `contracts/meta_messages.json` como subtipo de entrada con su renderer, y actualiza el permiso guardado.

### 4.2 Módulo nuevo `calls` (backend)

Tiene agregado y máquina de estados propios, así que no es una carpeta "por plantilla": va como módulo núcleo hexagonal, el 14.º.

```text
backend/app/modules/calls/
├── domain/          # Call, estados y transiciones, eventos, errores. Sin SQL ni HTTP
├── application/     # comandos + ports.py (CallRepository, CallControl, lectura de lead y de agentes)
├── infrastructure/  # repositorio SQL
├── ports/           # inbound.py (lo que usa el webhook), settings.py: contratos chicos con __all__
├── queries.py       # llamadas de un chat, las que suenan para mí, permiso vigente, estado de la función
├── api.py           # /api/calls/*
├── subscribers.py   # solo señalización por WebSocket
├── public.py        # eventos que otros módulos escuchan
└── schemas.py
```

Estados: `ringing` → `connecting` (alguien la reclamó) → `accepted` → `completed`; y los finales `missed`, `rejected`, `failed`. Las salientes empiezan en `dialing`.

**Hablar con Meta sin tocar las allowlists.** `tests/test_layering.py` solo deja importar `integrations.meta.client` a los archivos de `META_ALLOWED`, y esa lista no crece. Entonces:

- El control de llamadas es un puerto más del canal: `CallControl` en `integrations/whatsapp/channel.py` (que la capa de aplicación ya puede importar) y `WhatsAppChannel` gana el miembro `calls`.
- Lo implementa `MetaCallControl` en `integrations/meta/channel.py`, que ya está en la lista. Las funciones de Graph (`connect`, `accept`, `reject`, `terminate`, `call_permissions`, `settings.calling`, `is_on_biz_app`) van en `meta/client.py`.
- `integrations/meta/calls.py` solo arma y lee los cuerpos (webhook → evento del módulo, comando → payload). No importa el cliente: es puro y se prueba con fixtures.
- El webhook (`meta_webhook/processor.py`, también en la lista) llama a `calls.ports.inbound`.

**Transacciones.** Ninguna llamada a Graph ocurre dentro de una transacción con una fila bloqueada:

- Atender: (1) reclamar en una transacción corta (`UPDATE … WHERE status = 'ringing'` → `connecting`); (2) `accept` en Meta; (3) confirmar `accepted`. Si Meta falla, se libera el reclamo y vuelve a sonar para todos, o se cierra si Meta dice que la llamada ya terminó.
- Llamar: (1) crear la fila en `dialing` con id propio; (2) `connect` en Meta con ese id en `biz_opaque_callback_data`; (3) guardar el `wacid`. Los webhooks pueden llegar antes de (3): el handler enlaza por `biz_opaque_callback_data` cuando no encuentra el `wacid`.

**Eventos.** Los comandos registran eventos de dominio dentro de la unidad de trabajo y los suscriptores corren después del commit (no se usa `publish`, cuya lista tampoco crece): `CallRinging`, `CallClaimed`, `CallReleased`, `CallAnswerReady`, `CallEnded` (con `outcome`), `CallPermissionChanged`. Se publican en `calls/public.py`.

Quién reacciona a qué, siguiendo el patrón que ya usan citas y tareas:

| Suscriptor | Evento | Hace |
|---|---|---|
| `calls/subscribers.py` | todos | Señalización por WebSocket a los agentes |
| `notifications/subscribers.py` | `CallRinging`, `CallEnded` | Push de timbre; notificación de llamada perdida en la campanita y por push (§4.5) |
| `tasks/subscribers.py` | `CallEnded` | Crea la tarea "Devolver la llamada" si fue perdida; la completa cuando una llamada posterior con ese lead conecta |
| `conversations/subscribers.py` | `CallEnded` | `chats_updated` para que el hilo y la bandeja se refresquen |

**Seguridad de rutas.** Atender, colgar y llamar exigen `require_call_agent`, una dependencia que parte de `get_current_user` (el test de rutas la reconoce por transitividad: no se toca `AUTH_GUARDS` ni `PUBLIC_ROUTES`). Configurar exige `require_admin`. El SDP se valida (tamaño máximo, empieza con `v=0`) y **no se escribe en logs**.

### 4.3 Datos

Una revisión Alembic, por schema de tenant:

- **`whatsapp_calls`**: `id`, `wa_call_id` (único, nulo hasta que Meta lo asigna), `chat_id` → `leads`, `phone_number_id`, `direction`, `status`, `ringing_at`, `accepted_at`, `ended_at`, `duration_seconds`, `handled_by_user_id`, `claimed_by_client_id`, `error_code`, `remote_sdp` (se borra al terminar), `events` (JSONB con cada webhook, sin el SDP). Índices por `(chat_id, ringing_at)` y por `status` parcial sobre las no terminadas. **Sin audio ni transcripción: las llamadas no se graban.**
- **`lead_call_permissions`** (el permiso que da el cliente): `chat_id`, `status` (`none`/`temporary`/`permanent`), `expires_at`, `updated_at`. Tabla aparte, no columnas en `leads` (está en `EXTERNAL_TABLES`). Es una caché: antes de llamar se confirma con `GET /{phone-number-id}/call_permissions`, porque Meta no avisa cuando un permiso temporal vence.
- **`users.can_handle_calls`** (el permiso que da la admin): booleano, apagado por defecto. Al cambiarlo se invalida la caché de usuario (`invalidate_user_cache`).

Las llamadas **no** van a `wsp_messages`: esa tabla guarda el tipo literal de los mensajes de Meta y una llamada no es un mensaje. Tampoco se unen en la consulta del historial de `conversations` (obligaría a ampliar `FOREIGN_TABLES`): el frontend pide las llamadas del chat a `/api/calls` y las intercala en el hilo como un tipo de ítem más, junto a `activity`, `note` y `flow`.

El SDP queda además en el inbox (`public.webhook_inbox`) los 7 días de retención habitual. No es un secreto reutilizable (credenciales ICE de una sesión ya cerrada), pero es el motivo para no copiarlo a ningún otro lado.

### 4.4 Señalización hacia el navegador

`manager.send_to_user` ya entrega a todas las pestañas de un usuario en cualquier réplica. Eventos nuevos en `realtime/events.py`: `call_incoming`, `call_updated`, `call_ended`.

- **Los eventos nunca llevan el SDP.** El bus entre procesos viaja por `NOTIFY` de PostgreSQL y lo que pasa de 7500 bytes se entrega solo en el proceso local (`db/signals.py`); un SDP puede pasarse. El evento avisa y la pestaña pide el SDP por HTTP.
- **A quién**: a cada usuario activo con `can_handle_calls`, leído de la base en el momento (no del estado del socket). No es un `broadcast` al negocio.
- **Al reconectar o abrir la app**: la feature relee `GET /api/calls/ringing` (las que suenan para mí). Cubre el WebSocket caído, el deploy que cierra los sockets y el arranque desde una notificación.

**Llamada entrante**

1. Webhook `connect` (con la oferta SDP) → llamada en `ringing` → `CallRinging`.
2. `call_incoming` a los agentes conectados; push de timbre a todos los agentes.
3. Alguien pulsa Atender → el navegador pide el micrófono, lee la oferta (`GET /api/calls/{id}`), arma la respuesta, espera a reunir candidatos y la manda (`POST /api/calls/{id}/accept`, con el `client_id` de la pestaña).
4. El backend reclama, llama a Meta y confirma (§4.2). La primera persona gana; las demás reciben `call_updated` ("la atendió Fulana") y dejan de sonar.
5. Con el 200 de Meta el audio fluye.
6. Cuelga cualquiera → `terminate` → webhook con `duration` → `CallEnded(completed)` → tarjeta en el hilo.
7. Nadie atiende → `terminate` sin duración → `CallEnded(missed)` → §4.5.

**Llamada saliente**

1. Botón Llamar (solo agentes) → el backend consulta en Meta si el cliente dio permiso.
2. Sin permiso → se ofrece mandar el pedido (el mensaje interactivo **ya existe**: `call_permission_request` en `integrations/meta/outbound.py`). Fuera de la ventana de 24 h hace falta una plantilla con el componente de permiso.
3. Con permiso → el navegador arma la oferta (`POST /api/calls`) → `dialing` → Meta `connect`.
4. Webhooks: `RINGING` / `ACCEPTED` / `REJECTED` y `connect` con la respuesta SDP → `call_updated` solo tiene efecto en la pestaña que llamó (`client_id`), que pide la respuesta por HTTP. Mientras está "conectando", la pestaña también reconsulta cada 2 s por si el evento se perdió.

### 4.5 Notificaciones (timbre y llamada perdida)

Tres avisos distintos, cada uno con su canal:

| Momento | En la app abierta | Campanita | Push (app cerrada o en segundo plano) |
|---|---|---|---|
| Está sonando | Pantalla o aviso de llamada entrante con timbre | — | "Llamada entrante de {nombre}". Persistente, con vibración; al tocarla abre el CRM en la llamada |
| La atendió otra persona | El aviso se cierra con "La atendió {nombre}" | — | La notificación de timbre se reemplaza por "La atendió {nombre}" |
| **Se perdió** | Aviso "Llamada perdida de {nombre}" con Abrir chat | **Notificación guardada** `missed_call`, con enlace al chat | La notificación de timbre se reemplaza por **"Llamada perdida de {nombre}"**; al tocarla abre el chat |

Además de la notificación, la llamada perdida deja la tarjeta en el hilo, un indicador en la bandeja y la tarea "Devolver la llamada".

Lo que hay que cambiar en lo que existe:

- `NotificationType.MISSED_CALL` y su ícono en el centro de notificaciones. Se crea una por agente; se marca leída al abrir el chat, como las menciones.
- **El push de timbre y el de "perdida" comparten `tag`** (`call-{id}`): el segundo reemplaza al primero en vez de apilarse. Se reemplaza y no se borra en silencio porque iOS exige que cada push muestre algo y da de baja la suscripción si no.
- `push-sw.js` hoy muestra todas las notificaciones igual. Para el timbre necesita `requireInteraction`, `renotify` y patrón de vibración; el payload gana un campo `kind`.
- `send_push_to_user` hoy no fija vigencia ni urgencia. **A verificar:** `pywebpush` usa `ttl=0` por defecto, que significa "entregar ahora o descartar"; si es así, hoy un push a un celular sin conexión en ese instante se pierde. El timbre va con vigencia de 45 s y urgencia alta (pasado ese tiempo ya no sirve); la llamada perdida con 24 h.
- Los push de una llamada se mandan en paralelo y fuera del carril del webhook: hoy salen de a uno, y con cinco agentes el quinto se enteraría tarde.
- El service worker no muestra un push si hay una pestaña con foco (ya es así): con la app a la vista manda el WebSocket.

### 4.6 Frontend

Feature nueva `features/calls`, capa 6 de `FEATURE_LAYERS` (debajo de `chats`, que le pone el botón y la tarjeta; encima de `leads`). `notifications` (capa 8) ya puede mostrar el tipo nuevo.

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

`meta_call_permission_enabled`, hoy un interruptor manual, pasa a derivarse del estado real de las llamadas en Meta.

## 5. Fases, en detalle

Cada fase termina cuando pasan sus pruebas **y** sus criterios de usabilidad. En todas vale lo mismo de fondo: los comandos de CI de `CLAUDE.md` en verde, `test_layering.py` y `architecture.test.ts` **sin ampliar ninguna allowlist**, y `alembic check` limpio.

### Fase 0 · Viabilidad (sin código de producto)

**Objetivo.** Saber, antes de diseñar nada, si esto funciona como se espera. Sale con respuestas escritas, no con código que se conserve.

**Trabajo.**
1. Suscribir la app de Meta al campo `calls`.
2. Conseguir un número de prueba fuera de coexistencia (Meta tiene un sandbox de llamadas) y activarle las llamadas.
3. Un script descartable (una página HTML y un servidor mínimo, fuera del repo de producto) que reciba el webhook, atienda desde el navegador y también llame.
4. Mudar un número de prueba de coexistencia a solo API y anotar cada paso.

**Preguntas que tiene que responder.**

| # | Pregunta | Por qué importa |
|---|---|---|
| a | ¿Qué rol DTLS acepta Meta (la doc muestra `actpass` y `active`)? ¿Hay que tocar el SDP que genera el navegador? | Define si el navegador sirve sin trucos |
| b | ¿Conecta sin STUN/TURN en wifi de casa, de oficina y con datos móviles? | Es la base de la decisión de §3 |
| c | ¿Hace falta `pre_accept` para que no se corten las primeras palabras? | Complejidad del flujo de atender |
| d | En iPhone (PWA instalada) y Android: ¿llega el push con el celular bloqueado?, ¿cuánto tarda de tocar la notificación a poder atender?, ¿sigue el audio al apagar la pantalla o cambiar de app? | Decide si conviene mudar el número |
| e | ¿Cuánto tarda el webhook `connect` desde que el cliente marca? | Cuánto queda de los 30–60 s |
| f | ¿Cómo se muda un número de coexistencia a solo API y qué se pierde? | El texto del aviso de §2.1 |
| g | ¿Cuál es la tarifa oficial de Perú? | Para no prometer costos a ojo |

**Dispositivos.** Chrome, Edge, Firefox y Safari en computadora; iPhone con Safari y con la PWA instalada; Android con Chrome y con la PWA instalada.

**Listo cuando.** Las siete respuestas están en un anexo de este documento y se confirmó o corrigió §3. Si (d) sale mal en iPhone, se decide con ese dato si la función se limita a computadora y Android o si se pospone la mudanza.

### Fase 1 · Estado, aviso de mudanza y permiso por usuario

**Objetivo.** La admin entra a Integraciones y entiende por qué todavía no hay llamadas y qué tiene que hacer; elige quiénes van a atender. Se puede publicar sin que exista una sola llamada.

**Backend.**
- `users.can_handle_calls` (revisión Alembic propia), en el alta y edición de usuarios, con invalidación de caché; `auth.ports.users` publica la lista de agentes.
- En `meta/client.py`: lectura de `is_on_biz_app`/`platform_type` y de `settings.calling`. `CallControl.readiness()` en el canal.
- Esqueleto real del módulo `calls` solo con lo que esta fase usa: `queries.py` (estado de la función) y `api.py` (`GET /api/calls/readiness`, admin). Nada de carpetas vacías.

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
- Backend (dobles): `readiness` para cada combinación (coexistencia, límite bajo, sin agentes, activo); solo admin puede leerla y cambiar permisos; analista no puede recibir el permiso.
- Backend (Postgres real): la revisión aplica y `alembic check` queda limpio.
- Frontend (vitest): `CallsSettings` en sus cuatro estados más carga y error; el interruptor de usuario.
- e2e: la admin ve el aviso de mudanza en escritorio y celular; la vendedora no ve la sección.

**PRs.** (1) migración `users.can_handle_calls`; (2) backend de estado + permiso, con `schema.d.ts`; (3) frontend.

### Fase 2 · Recibir llamadas

**Objetivo.** Un cliente llama al número; a quienes tienen el permiso les suena; uno atiende, habla y cuelga; queda registrado en el chat. Si nadie atiende, queda como perdida y todos se enteran.

**Backend.**
- Revisión Alembic: `whatsapp_calls` y `lead_call_permissions`.
- Carril propio del inbox y regla del `connect` viejo (§4.1).
- Dominio (estados y transiciones), comandos de recibir, reclamar/atender, rechazar, colgar y registrar fin; repositorio SQL; puerto `CallControl` y su adaptador de Meta (`accept`, `reject`, `terminate`).
- Handler `calls` en el webhook y traducción en `integrations/meta/calls.py`.
- Rutas: `GET /api/calls/ringing`, `GET /api/calls/{id}`, `POST /api/calls/{id}/accept|reject|terminate`, `GET /api/calls?chat_id=`.
- Suscriptores de §4.2 y notificaciones de §4.5 (incluidos los cambios de push y del service worker).
- Ciclo que cierra llamadas colgadas.
- Configuración: activar, horario, devolución sin permiso (`POST settings`).
- Métricas: latencia webhook → aviso, llamadas por resultado, fallos de Graph por código; alerta si el p95 de latencia pasa de 3 s.

**Frontend.**
- `callSession` (dominio), `useCallSession`, proveedor en `app/`.
- `IncomingCall`, `ActiveCall`, `CallCard` en el hilo, indicador de perdida en la bandeja.
- `CallReadiness`: la preparación del dispositivo (ver Usabilidad).
- Horario y activación en `CallsSettings`.
- Ícono y texto de `missed_call` en el centro de notificaciones.

**Diseño: pantallas y estados.**

*Llamada entrante.*
- Computadora: aviso flotante arriba a la derecha, por encima de cualquier diálogo, que no tapa el chat abierto. Nombre del lead (o número si no tiene), etapa y vendedora asignada, y dos botones: Atender (primario) y Rechazar.
- Celular: pantalla completa. Nombre grande, botones de 64 px separados entre sí, en la mitad inferior, al alcance del pulgar.
- Timbre en bucle hasta que se resuelve; se corta al instante si otra persona atiende.
- Si quien recibe ya está en una llamada: aviso sin sonido ("Otra llamada: {nombre}"), sin botón Atender.

*Conectando.* Entre pulsar Atender y oír al cliente: "Conectando…" con los botones deshabilitados. Si pasa de 8 s, "Está tardando más de lo normal" con Colgar.

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
| No conectó el audio | "No se pudo conectar el audio. Puede ser la red" | Reintentar no existe: Abrir chat para escribirle |
| Meta rechazó la operación | Mensaje humano por código; el código queda en el registro, no en pantalla | Abrir chat |
| Se cayó la conexión en medio | "Se cortó la llamada" | Abrir chat |

**Usabilidad (se da por buena si).**
- **Preparación antes de la primera llamada.** Al recibir el permiso (y en cada dispositivo nuevo) el usuario ve una vez "Prepara este dispositivo para llamadas": conceder micrófono, activar notificaciones y una prueba de sonido. Sin esto, la primera llamada real se pierde detrás del cuadro de permisos del navegador, y el timbre no suena porque el navegador bloquea el audio sin una interacción previa.
- Atender es un solo toque. Colgar también, sin confirmación.
- De que suena a que se oye al cliente: menos de 3 s en computadora con la app abierta.
- En celular, de tocar la notificación a ver el botón Atender: lo que mida la fase 0, con una meta de menos de 6 s.
- Toda la llamada se maneja con teclado; el aviso entrante toma el foco sin robar lo que se estaba escribiendo (el borrador del redactor se conserva: ya existe `draftStore`).
- Los cambios de estado se anuncian a lectores de pantalla; los botones tienen nombre accesible; contraste AA en claro y oscuro.
- La pantalla no se apaga durante la llamada en celular.
- Vocabulario único en toda la app: "llamada perdida", "atender", "colgar", "devolver la llamada".

**Pruebas.**

*Backend, con dobles.*
- Máquina de estados, por tabla: todos los órdenes de eventos, incluidos `terminate` antes de `connect`, duplicados y un `ringing` tardío sobre una llamada cerrada.
- Traducción del webhook con fixtures nuevos en `tests/fixtures/meta/` (`calls_connect`, `calls_terminate_completed`, `calls_terminate_missed`, sin `from` y con BSUID, del número de avisos).
- `connect` con más de 60 s no hace sonar.
- Atender: reclamo ganado, reclamo perdido (409 con quién atendió), Meta falla y se libera, Meta dice que ya terminó.
- Solo agentes atienden; analista y usuario sin permiso reciben 403; un negocio no ve llamadas de otro.
- Notificaciones: la perdida crea una `missed_call` por agente y un push con el mismo `tag` que el timbre; la atendida no crea notificación guardada.
- Tarea de devolución: se crea en la perdida, para la vendedora asignada o sin asignar.
- El SDP no aparece en logs ni en `events`.
- Adaptador de Meta con el doble de transporte que ya usa `test_meta_client.py`.

*Backend, contra PostgreSQL real.*
- Dos `accept` simultáneos: exactamente uno gana.
- Dos workers procesando eventos de la misma llamada a la vez: un solo registro, estado final correcto.
- El carril de llamadas no toma mensajes ni el de mensajes toma llamadas; un mensaje lento no retrasa una llamada.
- El ciclo de limpieza cierra lo colgado y no toca lo vigente.

*Frontend (vitest).*
- `callSession` por tabla de transiciones.
- `useCallSession` con `RTCPeerConnection` y `getUserMedia` falsos (en `test/setup.ts`): atender, micrófono denegado, fallo de conexión, colgar, silenciar.
- `IncomingCall` y `ActiveCall` en cada estado; "la atendió otra persona"; segunda llamada estando en una.
- Handlers de tiempo real y relectura al reconectar.
- `CallCard` y la notificación `missed_call`.

*e2e (Playwright, backend y WebSocket simulados, escritorio y celular).*
- Suena, se atiende, se cuelga y aparece la tarjeta (con `RTCPeerConnection` sustituido y audio falso del navegador).
- Suena y otra persona atiende.
- Llamada perdida: aviso, campanita, tarjeta y tarea.
- Abrir la app con una llamada ya sonando (el camino de la notificación).
- Usuario sin permiso: no le suena ni ve controles.

*Con Meta de verdad (manual, fuera de CI), en la matriz de dispositivos de la fase 0.* Lista fija: atender, rechazar, colgar de cada lado, dejar sonar hasta perder, dos personas atendiendo a la vez, llamada durante un deploy, app cerrada en celular, wifi → datos en medio de la llamada.

**PRs.** (1) migración; (2) carril del inbox; (3) módulo `calls` + adaptador + webhook; (4) notificaciones y push; (5) frontend de llamada; (6) configuración y horario; (7) métricas y alerta. El (2) y el (4) son útiles aunque el resto se atrase.

**Listo cuando.** Todo lo anterior pasa y la lista manual se completó en al menos una computadora, un iPhone y un Android.

### Fase 3 · Llamar al cliente

**Objetivo.** Desde el chat, un agente llama a un cliente que dio permiso, o le pide el permiso; devuelve una llamada perdida con un toque.

**Backend.**
- `call_permission_reply` en el contrato de mensajes y en el webhook; actualiza `lead_call_permissions` y publica `CallPermissionChanged`.
- Comando de llamar (`dialing` → `connect`, §4.2), estados `RINGING`/`ACCEPTED`/`REJECTED` y `connect` con la respuesta SDP.
- Consulta de permiso y de límites a Meta (`call_permissions`), con caché corta.
- Rutas: `POST /api/calls`, `GET /api/calls/permission?chat_id=`.
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
- Backend (dobles): cada fila de la tabla del botón sale de `GET permission`; llamar sin permiso no llega a Meta; el webhook que llega antes de guardar el `wacid` se enlaza por el id propio; `REJECTED` y sin respuesta cierran bien; la respuesta del permiso actualiza la caché; fixtures `calls_status_*`, `calls_connect_answer`, `call_permission_reply_*`.
- Backend (Postgres real): dos pestañas del mismo usuario llaman al mismo lead a la vez → una sola llamada.
- Contrato: `test_meta_contract.py` y `metaContract.ts` regenerado con `python -m scripts.export_meta_contract`.
- Frontend (vitest): `CallButton` en cada fila de la tabla; flujo saliente en `callSession`; renderer del permiso.
- e2e: pedir permiso → llega la respuesta → llamar → colgar; devolver una perdida desde su tarjeta.
- Con Meta de verdad: permiso temporal y permanente, rechazo, sin respuesta, límite de pedidos.

**PRs.** (1) contrato + webhook del permiso; (2) llamada saliente en backend; (3) `CallButton` y flujo saliente; (4) "Llámanos" en mensajes y plantillas.

### Fase 4 · Medición

**Objetivo.** La dueña ve si las llamadas se atienden y cuánto cuestan.

**Trabajo.**
- `GET /api/calls/metrics` del propio módulo (no se une en las consultas del dashboard: obligaría a ampliar `FOREIGN_TABLES`): atendidas, perdidas, tasa de atención, tiempo hasta devolver una perdida, duración media, por persona y por franja horaria.
- Bloque en el dashboard que lo consume; llamadas en el panel de costos de Meta (`meta_costs`).
- Aviso a la admin cuando la tasa de atención baja de un umbral, antes de que Meta oculte el botón.

**Diseño y usabilidad.** Tres números arriba (atendidas, perdidas, tasa de atención) y la distribución por hora debajo, que es la que sirve para ajustar el horario. Las perdidas sin devolver son una lista accionable, no un número. Definiciones de cada métrica a un toque. Se revisa con el panel de debate (`debate-expertos`) antes de construirlo, como se hizo con el dashboard.

**Pruebas.** Métricas con datos sembrados en Postgres real (ventanas, zona horaria del negocio, llamadas que cruzan medianoche); componentes del bloque; e2e del dashboard con y sin llamadas.

### Fuera de alcance

Grabación y transcripción, buzón de voz, video, transferencia, IVR, bot de voz, SIP, app nativa, y "pausar mis llamadas" por usuario (se evalúa con datos de uso de la fase 2).

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

Supuesto que conviene confirmar: el botón **Llamar del CRM** usa el mismo permiso por usuario que atender. Si se quiere separar "puede atender" de "puede llamar", son dos interruptores en vez de uno.

Pendiente, y es la decisión de fondo: **si DermicaPro muda el número.** Hoy sus llamadas suenan en el celular por la app. Mudado, se atienden desde el CRM, con registro en el chat y varias personas a la vez, pero sin timbre de teléfono cuando el CRM está cerrado y sin la app (grupos, estados, difusión). La fase 0 (d) da el dato para decidirlo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Mudar el número es de una sola vía y su procedimiento no está documentado por Meta | Probarlo en la fase 0 con otro número; el aviso dice qué se pierde antes de ofrecer los pasos |
| En celular no suena con el CRM cerrado; iOS puede cortar el audio al salir de la app | Medirlo en la fase 0; push persistente con vibración; pantalla encendida durante la llamada |
| Botón visible para todos + pocas llamadas atendidas → Meta oculta el botón; reportes de clientes → pausa de 7 días | Horario obligatorio, tarea de devolución, aviso de tasa de atención (fase 4) |
| Llamadas que no suenan por cola o WebSocket caído | Carril propio, métrica de latencia, push y relectura al reconectar |
| La primera llamada se pierde tras el cuadro de permisos del navegador | Preparación del dispositivo al recibir el permiso |
| Nadie con permiso conectado | Queda como perdida con notificación y tarea; no se deja activar sin agentes |
| El rol DTLS o un detalle del SDP no coincide con la doc | Fase 0 antes de diseñar pantallas |
| Dos personas atienden a la vez / varias pestañas | Reclamo atómico en la base, por pestaña |
| Tarifa de Perú sin verificar | Fase 0 (g) |
| La doc de Meta tiene partes viejas (dice 5 llamadas/día en ejemplos; son 100) | Tratar los límites como dato que devuelve la API (`call_permissions`), no como constante |
