# 17 · Plan: llamadas de voz por la API oficial de WhatsApp (Calling API)

Fecha: 2026-11-18 · Estado: **propuesto, sin implementar** · Origen: pedido de producto ("que la vendedora pueda atender y hacer llamadas de WhatsApp desde el CRM").

Fuentes: la documentación de Meta leída el 2026-11-18 (`developers.facebook.com/documentation/business-messaging/whatsapp/calling/*`: overview, call-settings, user-initiated-calls, business-initiated-calls, user-call-permissions, sip, reference, faq, pricing, call-recording) y el código del repo a esa fecha. Lo que no se pudo verificar está marcado.

## 1. Qué se quiere y qué ofrece Meta

La Calling API es parte de la Cloud API desde julio de 2025. Permite que el número de WhatsApp del negocio **reciba** llamadas de voz de sus clientes y **llame** a quienes dieron permiso, sin pasar por la red telefónica. Solo voz: el video figura como "planeado" y no tiene API.

| | Llamada del cliente al negocio | Llamada del negocio al cliente |
|---|---|---|
| Costo | Gratis | Por duración, en pulsos de 6 s, según el país del cliente. Perú ≈ USD 0,012/min (**cifra de fuentes secundarias, sin verificar** en la tarifa oficial) |
| Permiso | No hace falta | El cliente debe haberlo dado (temporal 7 días o permanente) |
| Límites | — | 100 llamadas conectadas por día; 1 pedido de permiso cada 24 h y 2 cada 7 días por cliente; 4 llamadas seguidas sin contestar revocan el permiso |
| Efecto en la ventana de 24 h | La abre o renueva | La abre o renueva cuando el cliente contesta |

Lo que hace Meta y lo que queda del lado del CRM:

- **Señalización**: Meta avisa por webhook (campo `calls`) y el negocio responde por Graph API (`POST /{phone-number-id}/calls` con `connect`, `pre_accept`, `accept`, `reject`, `terminate`).
- **Audio**: WebRTC (ICE + DTLS-SRTP, Opus). El negocio pone el otro extremo. Meta contempla de forma explícita que ese extremo sea el dispositivo del agente.
- **Grabación y transcripción**: Meta las ofrece por llamada, con un anuncio hablado obligatorio; entrega el archivo por webhook y lo guarda 7 días. Hoy sin costo.
- **No hay**: transferencia entre agentes, renegociación de la llamada, llamadas grupales ni salida a la red telefónica (los términos la prohíben).

## 2. Requisitos previos (bloquean todo; ninguno es código)

| Requisito | Detalle | Estado |
|---|---|---|
| **El número no puede estar en coexistencia** | Meta exige que el número esté en Cloud API "y no en la app de WhatsApp Business"; su tabla de coexistencia dice "llamadas de voz y video: no soportadas". El CRM sí soporta coexistencia (`smb_message_echoes`) | **Confirmar por negocio.** Si el número del CRM de DermicaPro sigue en la app del celular, no se puede activar sin migrarlo del todo a Cloud API |
| Límite de mensajería ≥ 2000 | Con el límite inicial de 250 Meta rechaza la activación (error `138015`). Se sube con verificación del negocio o con volumen y calidad | Confirmar en WhatsApp Manager |
| Método de pago en la WABA | Aunque solo se reciban llamadas | Ya existe (se pagan plantillas) |
| La app de Meta suscrita al campo `calls` | Es una casilla en el panel de la app CliniVentas, una vez para toda la plataforma; `subscribed_apps` por WABA ya se hace en el alta | **Falta** |
| País | Llamar a clientes está vedado a números de EE. UU., Canadá, Egipto, Vietnam y Nigeria. Perú no está en la lista (se infiere: Meta no lo nombra) | OK |
| Cliente | Solo desde el celular (iPhone/Android). WhatsApp Web y Escritorio no pueden llamar a un negocio | Limitación a comunicar |

Consecuencia de producto: la función es **por negocio y condicionada**. Un tenant en coexistencia o con límite 250 la verá como "no disponible" con el motivo, igual que hoy el catálogo o los flows.

## 3. Decisión de arquitectura: el navegador es el teléfono

**El extremo WebRTC es el navegador de la vendedora; el backend solo retransmite la señalización.** El audio viaja directo entre el navegador y Meta.

Por qué alcanza:

- Meta usa ICE-lite y publica sus direcciones (IPv4 e IPv6) dentro del SDP. El navegador, detrás de cualquier NAT doméstico o de oficina, llega solo: no hace falta STUN ni TURN propios.
- No hay "trickle": el SDP va completo, una sola vez. El backend es un cartero de dos mensajes por llamada.
- Un deploy blue-green no corta el audio de una llamada en curso: el audio no pasa por el servidor. Lo único que puede fallar en ese momento es colgar, y se reintenta.
- No se suma ningún servicio nuevo al VPS (ni Asterisk, ni coturn, ni puertos UDP en Traefik).

Lo que se resigna (y por eso queda fuera del alcance):

- Transferir una llamada a otra vendedora, IVR ("marque 1"), bot de voz y escucha de la dueña en vivo: exigen un servidor de medios.
- Atender con la app cerrada o el celular bloqueado: un WebSocket en segundo plano no vive y el push web no abre el micrófono. La v1 es **con el CRM abierto**.
- Redes que bloquean UDP saliente (algunas corporativas): la llamada no conecta. Contingencia si aparece: un coturn propio con TCP/TLS. No se construye por adelantado.

La alternativa SIP (Meta ↔ una central propia) se descarta: al activarla se apagan los endpoints de Graph y casi todos los webhooks de `calls`, y obliga a operar una central por negocio.

## 4. Cómo encaja en el sistema

### 4.1 Entrada: el webhook y su latencia (el punto más delicado)

Hoy el webhook guarda cada `change` en el inbox (`integrations/meta_webhook/inbox.py`) y **un solo worker global los procesa de a uno, en orden** (`worker.py`), incluida la descarga de adjuntos. Está bien para mensajes; para una llamada no: el cliente escucha el tono y Meta da entre 30 y 60 s para aceptar. Un video pesado delante en la cola dejaría la llamada sin sonar.

Cambio propuesto:

- Los eventos `calls` siguen entrando al mismo inbox (se conserva la verificación de firma, la deduplicación por hash y la durabilidad).
- Se procesan en **un carril propio**: un segundo ciclo del worker que reclama solo `event_type = 'calls'`, mientras el actual los excluye. `claim_events` ya filtra por `ids`; se le agrega el filtro por tipo.
- Métrica nueva: segundos entre `received_at` del evento `connect` y el aviso por WebSocket, con alerta si el p95 pasa de 3 s.

El handler `calls` en `FIELD_HANDLERS` (`processor.py`) traduce y llama a los comandos del módulo nuevo. Tiene que tolerar lo que Meta advierte:

- **Duplicados y desorden**: `terminate` puede llegar antes que `connect`. El estado de la llamada se guarda por `wacid` con transiciones monótonas (un `terminate` nunca se pisa con un `ringing` tardío).
- **Sin teléfono**: con usuarios con nombre de usuario Meta puede omitir `from`/`wa_id` y mandar solo el BSUID. `integrations/whatsapp/identity.py` ya resuelve por `wa_id` y `user_id`; se reutiliza tal cual.
- **Número de avisos de cita**: sus llamadas se ignoran, como hoy sus mensajes (`_is_notice_number`). En ese número conviene dejar las llamadas desactivadas en Meta.

Además, en `messages` aparecen dos cosas nuevas:

- `interactive/call_permission_reply` (el cliente aceptó o rechazó el permiso): entra al contrato `contracts/meta_messages.json` como subtipo de entrada con su renderer, y actualiza el permiso guardado.
- El buzón de voz (si se activa) llega como audio cuyo `id` es el `wacid`: se enlaza a la llamada perdida.

### 4.2 Módulo nuevo `calls` (backend)

Tiene agregado y máquina de estados propios, así que no es una carpeta "por plantilla": va como módulo núcleo hexagonal, el 14.º.

```text
backend/app/modules/calls/
├── domain/          # Call, estados (ringing → accepted → completed | missed | rejected | failed), errores
├── application/     # recibir timbre, atender, rechazar, colgar, llamar, registrar fin, registrar permiso
│   └── ports.py     # CallChannel (Meta), CallRepository, lectura de lead por public de leads
├── infrastructure/  # repositorio SQL
├── queries.py       # llamadas de un chat, llamada en curso, permiso vigente
├── api.py           # /api/calls/*
├── subscribers.py   # avisos por WebSocket y push
├── public.py · schemas.py
backend/app/integrations/meta/calls.py   # adaptador: connect, pre_accept, accept, reject, terminate,
                                         # call_permissions, settings.calling
```

Reglas que condicionan el diseño (`tests/test_layering.py`):

- Los casos de uso levantan `DomainError`; `HTTPException` solo en `api.py`.
- El aviso por WebSocket sale de `subscribers.py`, después del commit, a partir de eventos de dominio (`CallRinging`, `CallClaimed`, `CallAnswerReady`, `CallEnded`).
- El lead y su vendedora asignada se leen por el `public.py` de `leads`; no se amplía `FOREIGN_TABLES`.
- Toda ruta con guard de sesión: no se toca `PUBLIC_ROUTES`.

### 4.3 Datos

Una revisión Alembic, por schema de tenant:

- **`whatsapp_calls`**: `wa_call_id` (único), `chat_id` → `leads`, `phone_number_id`, `direction`, `status`, `ringing_at`, `accepted_at`, `ended_at`, `duration_seconds`, `handled_by_user_id`, `claimed_by_client_id`, `error_code`, `remote_sdp` (se borra al terminar), `recording_url`, `transcript`, `events` (JSONB con cada webhook crudo).
- **Permiso de llamada del lead**: `status` (`none`/`temporary`/`permanent`), `expires_at`, `updated_at`. Tabla chica aparte, no columnas en `leads` (está en `EXTERNAL_TABLES` y su migración es manual). Es una caché: antes de llamar se confirma con `GET /{phone-number-id}/call_permissions`, porque Meta no avisa cuando un permiso temporal vence.

Las llamadas **no** van a `wsp_messages`: esa tabla guarda el tipo literal de los mensajes de Meta y una llamada no es un mensaje. En el hilo se muestran como tarjeta intercalada, igual que hoy el cambio de etapa, la nota interna o el mensaje programado.

### 4.4 Señalización hacia el navegador

Ya existe lo necesario: `manager.send_to_user` entrega a todas las pestañas de un usuario en cualquier réplica, y el worker llega a los navegadores por el bus de señales. Eventos nuevos en `realtime/events.py`: `call_incoming`, `call_updated`, `call_ended`.

**Llamada entrante**

1. Webhook `connect` (trae la oferta SDP) → se guarda la llamada en `ringing`.
2. `call_incoming` a quien deba sonar (§6, decisión 2), sin el SDP. Push web en paralelo para quien tiene el CRM en otra pestaña.
3. La vendedora pulsa Atender → el navegador pide el micrófono, lee la oferta (`GET /api/calls/{id}`), arma la respuesta, espera a terminar de reunir candidatos y la manda (`POST /api/calls/{id}/accept`).
4. El backend **reclama** la llamada de forma atómica (`UPDATE … WHERE status = 'ringing'`): la primera gana, las demás reciben "la atendió Fulana". Recién entonces llama a Meta (`accept`).
5. Con el 200 de Meta el audio fluye. A las otras vendedoras les llega `call_updated` y deja de sonar.
6. Cuelga cualquiera → `terminate` → webhook con `duration` → tarjeta en el hilo.
7. Nadie atiende → Meta manda `terminate` sin duración → **llamada perdida**: tarjeta en el hilo, notificación y tarea "Devolver la llamada" para la vendedora asignada.

**Llamada saliente**

1. Botón Llamar en el encabezado del chat → el backend consulta el permiso en Meta.
2. Sin permiso → se ofrece mandar el pedido de permiso (el mensaje interactivo **ya existe**: `call_permission_request` en `integrations/meta/outbound.py`, detrás de `meta_call_permission_enabled`). Fuera de la ventana de 24 h hace falta una plantilla con el componente de permiso.
3. Con permiso → el navegador arma la oferta y la manda (`POST /api/calls`); el backend llama a Meta (`connect`) con el id interno en `biz_opaque_callback_data`.
4. Webhooks: estados `RINGING` / `ACCEPTED` / `REJECTED` y `connect` con la respuesta SDP → llegan solo a la pestaña que llamó (se filtra por `client_id`). Si el WebSocket estaba caído, la pestaña los recupera consultando la llamada mientras está "conectando".

### 4.5 Frontend

Feature nueva `features/calls`, en la capa 6 de `FEATURE_LAYERS` (debajo de `chats`, que le pone el botón; encima de `leads`):

- **Sesión de llamada a nivel de app**, no del chat: cambiar de pantalla no puede cortar el audio. `app/` la monta por el `index` de la feature.
- **Aviso de llamada entrante** con timbre, nombre del lead y Atender / Rechazar; **barra de llamada activa** con cronómetro, silenciar, colgar y selector de micrófono.
- **Botón Llamar** en el encabezado del chat con el estado del permiso ("con permiso hasta el 25", "pedir permiso", "ya se pidió hoy").
- **Tarjeta de llamada** en el hilo: entrante/saliente, duración, quién atendió, perdida, y más adelante el audio y la transcripción.
- HTTP solo en `features/calls/api.ts`, claves en `keys.ts`, tipos regenerados en `schema.d.ts` en el mismo PR.

El micrófono ya se usa para notas de voz (`shared/ui/VoiceRecorder.tsx`) y la app no tiene una `Permissions-Policy` que lo bloquee (solo la landing). Pruebas: vitest con un `RTCPeerConnection` falso; Playwright con dispositivos de audio simulados.

### 4.6 Configuración del negocio

En el panel de WhatsApp del negocio, sobre `POST/GET /{phone-number-id}/settings`:

- Activar o desactivar llamadas; mostrar u ocultar el ícono de llamada en el chat del cliente.
- **Horario de atención de llamadas** (fuera de horario el cliente no puede llamar y se le ofrece pedir que lo llamen). Importa: Meta **oculta el botón** si la tasa de atención es baja.
- Permiso automático al devolver una llamada (`callback_permission_status`): quien llamó puede ser llamado de vuelta sin pedirle permiso.
- Estado y restricciones que informe Meta, y chequeo de requisitos (límite, coexistencia) en la lista de alta.

`meta_call_permission_enabled`, hoy un interruptor manual, pasa a derivarse del estado real de las llamadas en Meta.

## 5. Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **0 · Viabilidad** (sin código de producto) | Confirmar §2 para DermicaPro; suscribir `calls`; con un número de prueba, un script descartable que atienda una llamada desde Chrome. Despeja la duda técnica real: el rol DTLS (la doc de Meta se contradice entre `actpass` y `active`) y que el audio conecte sin TURN | Acceso al panel de Meta |
| **1 · Recibir llamadas** | Carril propio en el inbox; módulo `calls`; timbre, atender, rechazar, colgar; llamada perdida con tarea; tarjeta en el hilo | Fase 0 |
| **2 · Llamar** | Permisos (respuesta del cliente, consulta, límites visibles); botón Llamar; devolver llamada perdida; botón "Llámanos" en mensajes y plantillas (`voice_call`, que hoy la importación de plantillas marca como no soportado) | Fase 1 |
| **3 · Operación** | Configuración y horarios desde el CRM; grabación y transcripción guardadas en MinIO y disponibles para el analista de leads; llamadas en el panel de costos y en el dashboard (atendidas, perdidas, tiempo hasta devolver) | Fase 2 |
| Fuera de alcance | Video, transferencia, IVR, bot de voz, SIP, atender con la app cerrada | — |

Forma de los PRs, por las convenciones del repo: la revisión Alembic va sola; cada cambio de API regenera `schema.d.ts`; nada de traslados mezclados con contrato.

## 6. Decisiones que necesita producto

1. **¿El número del CRM de DermicaPro está en coexistencia?** Es la pregunta que decide si esto se puede hacer ya.
2. **¿A quién le suena?** Propuesta: a la vendedora asignada al lead si está conectada; si no hay asignada o no está, a todas las conectadas, y atiende la primera.
3. **¿Se graba?** Meta antepone un anuncio hablado obligatorio. Sirve para calidad y para alimentar al analista, pero cambia la experiencia del cliente y hay que reflejarlo en la política de datos (Ley 29733).
4. **¿Dónde atienden las vendedoras?** Si trabajan sobre todo desde el celular, la limitación de "con el CRM abierto" pesa mucho más que en escritorio.
5. **¿Activar el botón de llamar para todos los clientes o solo responder a pedido?** Un botón visible sin gente para atender baja la tasa de atención y Meta lo oculta.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Coexistencia o límite 250 en el tenant | Chequeo en la fase 0 y estado "no disponible" con motivo |
| Llamadas que no suenan por cola o WebSocket caído | Carril propio, métrica de latencia, push web y reconsulta al reconectar |
| Pocas llamadas atendidas → Meta oculta el botón; reportes de clientes → pausa de 7 días | Horario de llamadas, tarea de devolución, permiso solo a pedido |
| El rol DTLS o un detalle del SDP no coincide con la doc | Fase 0 con número de prueba antes de diseñar pantallas |
| Dos vendedoras atienden a la vez / varias pestañas | Reclamo atómico en la base, por pestaña |
| Tarifa de Perú sin verificar | Leer la tarifa oficial antes de prometer costos a un cliente |
| La doc de Meta tiene partes viejas (dice 5 llamadas/día en ejemplos; son 100) | Tratar los límites como dato que devuelve la API (`call_permissions`), no como constante |
