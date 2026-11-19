# 17 · Plan: llamadas de voz por la API oficial de WhatsApp (Calling API)

Fecha: 2026-11-18 · Actualizado: 2026-11-19 con las decisiones de producto (§6) · Estado: **propuesto, sin implementar** · Origen: pedido de producto ("que el equipo pueda atender y hacer llamadas de WhatsApp desde el CRM").

Fuentes: la documentación de Meta leída el 2026-11-18 (`developers.facebook.com/documentation/business-messaging/whatsapp/calling/*`: overview, call-settings, user-initiated-calls, business-initiated-calls, user-call-permissions, sip, reference, faq, pricing; y `embedded-signup/onboarding-business-app-users` para coexistencia) y el código del repo a esa fecha. Lo que no se pudo verificar está marcado.

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

**Detección.** `GET /{phone-number-id}?fields=is_on_biz_app,platform_type`: con `is_on_biz_app = true` el número sigue en la app. Se consulta al abrir la tarjeta y al intentar activar; no se guarda como ajuste manual.

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
- Esto se mide en la fase 0 con celulares reales (iPhone con la PWA instalada y Android), no se supone.

La alternativa SIP (Meta ↔ una central propia) se descarta: al activarla se apagan los endpoints de Graph y casi todos los webhooks de `calls`, y obliga a operar una central por negocio.

## 4. Cómo encaja en el sistema

### 4.1 Entrada: el webhook y su latencia (el punto más delicado)

Hoy el webhook guarda cada `change` en el inbox (`integrations/meta_webhook/inbox.py`) y **un solo worker global los procesa de a uno, en orden** (`worker.py`), incluida la descarga de adjuntos. Está bien para mensajes; para una llamada no: un video pesado delante en la cola dejaría la llamada sin sonar.

Cambio propuesto:

- Los eventos `calls` siguen entrando al mismo inbox (se conserva la verificación de firma, la deduplicación por hash y la durabilidad).
- Se procesan en **un carril propio**: un segundo ciclo del worker que reclama solo `event_type = 'calls'`, mientras el actual los excluye. `claim_events` ya filtra por `ids`; se le agrega el filtro por tipo.
- Métrica nueva: segundos entre `received_at` del evento `connect` y el aviso por WebSocket, con alerta si el p95 pasa de 3 s.

El handler `calls` en `FIELD_HANDLERS` (`processor.py`) traduce y llama a los comandos del módulo nuevo. Tiene que tolerar lo que Meta advierte:

- **Duplicados y desorden**: `terminate` puede llegar antes que `connect`. El estado se guarda por `wacid` con transiciones monótonas.
- **Sin teléfono**: con usuarios con nombre de usuario Meta puede omitir `from`/`wa_id` y mandar solo el BSUID. `integrations/whatsapp/identity.py` ya resuelve por `wa_id` y `user_id`; se reutiliza tal cual.
- **Número de avisos de cita**: sus llamadas se ignoran, como hoy sus mensajes (`_is_notice_number`), y en Meta se dejan desactivadas.

Además, en `messages` aparece `interactive/call_permission_reply` (el cliente aceptó o rechazó que lo llamen): entra al contrato `contracts/meta_messages.json` como subtipo de entrada con su renderer, y actualiza el permiso guardado.

### 4.2 Módulo nuevo `calls` (backend)

Tiene agregado y máquina de estados propios, así que no es una carpeta "por plantilla": va como módulo núcleo hexagonal, el 14.º.

```text
backend/app/modules/calls/
├── domain/          # Call, estados (ringing → accepted → completed | missed | rejected | failed), errores
├── application/     # recibir timbre, atender, rechazar, colgar, llamar, registrar fin, registrar permiso
│   └── ports.py     # CallChannel (Meta), CallRepository, lectura de lead y de quiénes atienden
├── infrastructure/  # repositorio SQL
├── queries.py       # llamadas de un chat, llamada en curso, permiso vigente, estado de la función
├── api.py           # /api/calls/*
├── subscribers.py   # avisos por WebSocket y push
├── public.py · schemas.py
backend/app/integrations/meta/calls.py   # adaptador: connect, pre_accept, accept, reject, terminate,
                                         # call_permissions, settings.calling, is_on_biz_app
```

Reglas que condicionan el diseño (`tests/test_layering.py`, `tests/test_route_security.py`):

- Los casos de uso levantan `DomainError`; `HTTPException` solo en `api.py`.
- El aviso por WebSocket sale de `subscribers.py`, después del commit, a partir de eventos de dominio (`CallRinging`, `CallClaimed`, `CallAnswerReady`, `CallEnded`).
- El lead se lee por el `public.py` de `leads` y quiénes atienden por el de `auth`; no se amplía `FOREIGN_TABLES`.
- Toda ruta con guard: atender, colgar y llamar exigen el permiso de llamadas (§4.6); configurar exige admin. No se toca `PUBLIC_ROUTES`.

### 4.3 Datos

Una revisión Alembic, por schema de tenant:

- **`whatsapp_calls`**: `wa_call_id` (único), `chat_id` → `leads`, `phone_number_id`, `direction`, `status`, `ringing_at`, `accepted_at`, `ended_at`, `duration_seconds`, `handled_by_user_id`, `claimed_by_client_id`, `error_code`, `remote_sdp` (se borra al terminar), `events` (JSONB con cada webhook crudo). **Sin audio ni transcripción: las llamadas no se graban.**
- **Permiso de llamada del lead** (el que da el cliente): `status` (`none`/`temporary`/`permanent`), `expires_at`, `updated_at`. Tabla chica aparte, no columnas en `leads` (está en `EXTERNAL_TABLES`). Es una caché: antes de llamar se confirma con `GET /{phone-number-id}/call_permissions`, porque Meta no avisa cuando un permiso temporal vence.
- **Permiso de llamadas del usuario** (el que da la admin): `users.can_handle_calls`, booleano, apagado por defecto.

Las llamadas **no** van a `wsp_messages`: esa tabla guarda el tipo literal de los mensajes de Meta y una llamada no es un mensaje. En el hilo se muestran como tarjeta intercalada, igual que hoy el cambio de etapa o la nota interna.

### 4.4 Señalización hacia el navegador

Ya existe lo necesario: `manager.send_to_user` entrega a todas las pestañas de un usuario en cualquier réplica, y el worker llega a los navegadores por el bus de señales. Eventos nuevos en `realtime/events.py`: `call_incoming`, `call_updated`, `call_ended`. Se mandan usuario por usuario a quienes tienen el permiso, no a todo el negocio.

**Llamada entrante**

1. Webhook `connect` (trae la oferta SDP) → se guarda la llamada en `ringing`.
2. `call_incoming` a **todos los usuarios con permiso de llamadas** que estén conectados, sin el SDP. Push en paralelo a los que tienen el permiso y no están conectados.
3. Alguien pulsa Atender → el navegador pide el micrófono, lee la oferta (`GET /api/calls/{id}`), arma la respuesta, espera a terminar de reunir candidatos y la manda (`POST /api/calls/{id}/accept`).
4. El backend **reclama** la llamada de forma atómica (`UPDATE … WHERE status = 'ringing'`): la primera persona gana, las demás ven "la atendió Fulana". Recién entonces llama a Meta (`accept`).
5. Con el 200 de Meta el audio fluye. Al resto le llega `call_updated` y deja de sonar.
6. Cuelga cualquiera → `terminate` → webhook con `duration` → tarjeta en el hilo.
7. Nadie atiende → Meta manda `terminate` sin duración → **llamada perdida**: tarjeta en el hilo, notificación a quienes tienen el permiso y tarea "Devolver la llamada" para la vendedora asignada al lead (o sin asignar si no tiene).

**Llamada saliente**

1. Botón Llamar en el encabezado del chat (solo usuarios con permiso) → el backend consulta en Meta si el cliente dio permiso.
2. Sin permiso del cliente → se ofrece mandar el pedido (el mensaje interactivo **ya existe**: `call_permission_request` en `integrations/meta/outbound.py`). Fuera de la ventana de 24 h hace falta una plantilla con el componente de permiso.
3. Con permiso → el navegador arma la oferta y la manda (`POST /api/calls`); el backend llama a Meta (`connect`) con el id interno en `biz_opaque_callback_data`.
4. Webhooks: estados `RINGING` / `ACCEPTED` / `REJECTED` y `connect` con la respuesta SDP → llegan solo a la pestaña que llamó (se filtra por `client_id`). Si el WebSocket estaba caído, la pestaña los recupera consultando la llamada mientras está "conectando".

### 4.5 Frontend

Feature nueva `features/calls`, en la capa 6 de `FEATURE_LAYERS` (debajo de `chats`, que le pone el botón; encima de `leads`):

- **Sesión de llamada a nivel de app**, no del chat: cambiar de pantalla no puede cortar el audio. `app/` la monta por el `index` de la feature.
- **Llamada entrante**: en computadora, un aviso flotante con timbre, nombre del lead y Atender / Rechazar. En celular, pantalla completa con botones grandes: es lo que se abre al tocar la notificación y hay segundos contados.
- **Llamada activa**: en computadora, una barra con cronómetro, silenciar, colgar y selector de micrófono. En celular, pantalla propia que se puede minimizar a una barra para ver el chat mientras se habla.
- **Botón Llamar** en el encabezado del chat con el estado del permiso del cliente ("con permiso hasta el 25", "pedir permiso", "ya se pidió hoy"). Solo lo ven los usuarios con permiso de llamadas y solo si la función está activa.
- **Tarjeta de llamada** en el hilo: entrante/saliente, duración, quién atendió, perdida.
- **Sección Llamadas** en Integraciones → WhatsApp con los estados de §2.1.
- HTTP solo en `features/calls/api.ts`, claves en `keys.ts`, tipos regenerados en `schema.d.ts` en el mismo PR.

El micrófono ya se usa para notas de voz (`shared/ui/VoiceRecorder.tsx`) y la app no tiene una `Permissions-Policy` que lo bloquee (solo la landing). Pruebas: vitest con un `RTCPeerConnection` falso; Playwright con dispositivos de audio simulados, en los dos tamaños que ya corre `e2e/` (escritorio y celular).

### 4.6 Configuración del negocio

Todo en Integraciones → WhatsApp → Llamadas, solo admin:

- **Activar o desactivar** (`POST /{phone-number-id}/settings`), con los estados y el aviso de mudanza de §2.1.
- **Quiénes atienden**: lista de usuarios con un interruptor cada uno (`can_handle_calls`). El mismo interruptor aparece en la ficha del usuario, en Configuración → Usuarios. El rol analista no puede tenerlo: no abre chats ni tiene tiempo real. Si nadie lo tiene, la función no se deja activar.
- **Botón de llamar visible para todos los clientes** (`call_icon_visibility: DEFAULT`): cualquier cliente puede llamar desde el chat del negocio. No se expone como opción.
- **Horario de atención de llamadas**: fuera de horario el cliente no puede llamar. Es obligatorio configurarlo al activar, por la decisión anterior: con el botón a la vista de todos, cada llamada que nadie atiende baja la tasa de atención, y Meta **oculta el botón** cuando es baja.
- **Devolver llamadas sin pedir permiso** (`callback_permission_status`): quien llamó puede ser llamado de vuelta durante 7 días. Encendido por defecto: es lo que hace útil la tarea "Devolver la llamada".

`meta_call_permission_enabled`, hoy un interruptor manual, pasa a derivarse del estado real de las llamadas en Meta.

## 5. Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **0 · Viabilidad** (sin código de producto) | Suscribir `calls`; con un número de prueba que no esté en coexistencia, un script descartable que atienda una llamada. Responde tres dudas: (a) el rol DTLS, donde la doc de Meta se contradice; (b) cómo se comporta en iPhone con la PWA y en Android, con la pantalla apagada y desde la notificación; (c) cómo se muda un número de coexistencia a solo API y qué se pierde | Acceso al panel de Meta y un número de prueba |
| **1 · Estado y aviso** | Sección Llamadas en Integraciones con detección de coexistencia y requisitos, el aviso de mudanza y el permiso por usuario. Se puede publicar sola: explica por qué todavía no hay llamadas | Fase 0 (c) para el texto de los pasos |
| **2 · Recibir llamadas** | Carril propio en el inbox; módulo `calls`; timbre a quienes tienen permiso, atender, rechazar, colgar; push; llamada perdida con tarea; tarjeta en el hilo; horario; pantallas de computadora y celular | Fase 0 (a, b) |
| **3 · Llamar** | Permiso del cliente (respuesta, consulta, límites visibles); botón Llamar; devolver llamada perdida; botón "Llámanos" en mensajes y plantillas (`voice_call`, que hoy la importación de plantillas marca como no soportado) | Fase 2 |
| **4 · Medición** | Llamadas en el panel de costos y en el dashboard (atendidas, perdidas, tiempo hasta devolver, por persona) | Fase 3 |
| Fuera de alcance | Grabación y transcripción, buzón de voz, video, transferencia, IVR, bot de voz, SIP, app nativa | — |

Las fases 1 a 4 se construyen y prueban con el número de prueba. **Para DermicaPro la activación real espera a que muden su número**; hasta entonces ven el aviso.

Forma de los PRs, por las convenciones del repo: la revisión Alembic va sola; cada cambio de API regenera `schema.d.ts`; nada de traslados mezclados con contrato.

## 6. Decisiones de producto

Tomadas el 2026-11-19:

| Tema | Decisión | Dónde quedó |
|---|---|---|
| Número en coexistencia | DermicaPro lo está. El CRM lo detecta y avisa que hay que mudarlo; no se bloquea la construcción | §2.1 |
| A quién le suena | A todos los usuarios con permiso de llamadas, configurable por la admin | §4.4, §4.6 |
| Grabación | No se graba | §4.3, fuera de alcance |
| Dispositivo | Computadora y celular, cualquier usuario con permiso; diseño responsive | §3, §4.5 |
| Botón de llamar del cliente | Visible para todos los clientes | §4.6 |

Supuesto que conviene confirmar: el botón **Llamar del CRM** (llamar al cliente) usa el mismo permiso por usuario que atender. Si se quiere separar "puede atender" de "puede llamar", son dos interruptores en vez de uno.

Pendiente, y es la decisión de fondo: **si DermicaPro muda el número.** Hoy sus llamadas suenan en el celular por la app. Mudado, se atienden desde el CRM, con registro en el chat y varias personas a la vez, pero sin timbre de teléfono cuando el CRM está cerrado y sin la app (grupos, estados, difusión). La fase 0 (b) da el dato para decidirlo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Mudar el número es de una sola vía y su procedimiento no está documentado por Meta | Probarlo en la fase 0 con otro número; el aviso dice qué se pierde antes de ofrecer los pasos |
| En celular no suena con el CRM cerrado; iOS puede cortar el audio al salir de la app | Medirlo en la fase 0; push con sonido; pantalla encendida durante la llamada; horario realista |
| Botón visible para todos + pocas llamadas atendidas → Meta oculta el botón; reportes de clientes → pausa de 7 días | Horario obligatorio, tarea de devolución, tasa de atención visible para la admin |
| Llamadas que no suenan por cola o WebSocket caído | Carril propio, métrica de latencia, push y reconsulta al reconectar |
| Nadie con permiso conectado | Queda como perdida con tarea; el estado de la sección avisa si nadie tiene el permiso |
| El rol DTLS o un detalle del SDP no coincide con la doc | Fase 0 antes de diseñar pantallas |
| Dos personas atienden a la vez / varias pestañas | Reclamo atómico en la base, por pestaña |
| Tarifa de Perú sin verificar | Leer la tarifa oficial antes de prometer costos a un cliente |
| La doc de Meta tiene partes viejas (dice 5 llamadas/día en ejemplos; son 100) | Tratar los límites como dato que devuelve la API (`call_permissions`), no como constante |
