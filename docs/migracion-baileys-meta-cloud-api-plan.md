# Plan: migrar la instancia de Baileys a WhatsApp Business (Meta Cloud API) vía Evolution

> Estado: propuesta para revisión. No se ha tocado código de producto todavía.
> Punto de partida: la app ya está verificada como **Tech Provider** de Meta, lo
> que habilita Embedded Signup. Se mantiene Evolution como capa de abstracción
> (integración `WHATSAPP-BUSINESS`, que internamente usa `BusinessStartupService`
> en vez de `BaileysStartupService`) en lugar de ir directo a la Graph API — ver
> el análisis de opciones que motivó esta decisión.

## 1. Objetivo

Reemplazar el transporte no oficial (Baileys/WhatsApp Web) de la instancia de
Evolution por el oficial (Meta Cloud API), aprovechando que Evolution ya
normaliza ambos proveedores detrás de la misma API REST y del mismo esquema de
webhooks. El código que ya consume esa API — [evolution_service.py](../backend/services/evolution_service.py),
la ingesta por RabbitMQ y el workflow `rag` de n8n — cambia lo mínimo posible;
lo que cambia es **qué hay detrás** de la instancia.

## 2. Supuesto crítico a validar antes de comprometerse con el resto del plan

Todo este plan asume que **Evolution normaliza el webhook de una instancia
`WHATSAPP-BUSINESS` a la misma forma que ya usa Baileys** — mismo evento
`messages.upsert`, mismo `data.key.remoteJid` con sufijo `@s.whatsapp.net`,
mismo `instance` en el cuerpo — porque **todo** lo que sigue depende de esa
forma: el nodo `Switch Control type` de `rag.json`, el binding de RabbitMQ a
`evolution_exchange` con las routing keys `messages.upsert`/`send.message`, y
`parse_evolution_identity` en
[whatsapp_identity_service.py](../backend/services/whatsapp_identity_service.py).

Si Evolution en modo Business pasa el payload nativo de Meta (`wa_id` sin
sufijo, estructura `entry[].changes[].value`) sin normalizar, el impacto es
mucho mayor: hay que tocar el `Switch Control type`, los nodos `* content*`, el
parser de identidad y potencialmente el binding del exchange. **Por eso la
Etapa 0 es un spike de una tarde, no un trámite.**

## 3. Qué se mantiene igual y qué cambia (resumen)

| Área | Se mantiene | Cambia |
|---|---|---|
| Envío (`evolution_service.py`) | Mismos endpoints (`sendText`, `sendMedia`, `sendTemplate`, etc.) | `send_whatsapp_template` deja de estar bloqueada (`get_template_capabilities` ya detecta `WHATSAPP-BUSINESS`) |
| Ingesta RabbitMQ (`mq/definitions.json`, `evolution_exchange`) | Topología completa, si se confirma el supuesto de la sección 2 | Nada, en el caso favorable |
| n8n (`rag.json`, `webhooks-evolution-rabbitmq.json`) | La lógica de negocio (agente analista, IA de adjuntos) | Puede necesitar ajustes en `Switch Control type` / `* content*` según lo que salga del spike |
| Identidad (`whatsapp_identity_service.py`) | El modelo de alias por lead sigue sirviendo | Ya no habrá `@lid` — todo entra como `kind='phone'`; el código lo tolera sin cambios, pero `resolve_history_jid` y `aliases_from_send_key` quedan sin propósito para esta instancia (documentar, no borrar mientras convivan instancias Baileys) |
| Historial (`find_chat_messages`, `chat/findMessages`) | — | **Se pierde.** Cloud API no expone historial retroactivo. Ninguna instancia Business puede traer mensajes previos a su conexión |
| Edición/borrado (`edit_whatsapp_message`, `delete_whatsapp_message`) | — | **Deja de funcionar.** Meta Cloud API no soporta editar ni "eliminar para todos" un mensaje saliente vía API |
| Mensajería libre | — | **Fuera de la ventana de 24 h desde el último mensaje del cliente, solo se pueden mandar plantillas aprobadas.** Cambio de UX para el vendedor |
| Stickers, reacciones, botones, listas | Soportado en ambos | Sin cambios funcionales relevantes |
| Onboarding | — | Deja de ser QR; pasa a ser Embedded Signup (Tech Provider) — resuelve el problema de fragilidad de [[whatsapp-qr-connect]] descrito en `multi-tenant-saas-plan.md` |

## 4. Etapas

### Etapa 0 — Spike de validación (no toca producción)

**Qué hacer:**
1. Crear una WABA y un número de **prueba** de Meta (Meta ofrece números de test gratuitos para desarrollo — no gastan cuota de plantillas) usando el flujo de Embedded Signup ya habilitado por el Tech Provider.
2. Levantar una segunda instancia de Evolution, aparte de `dermicapro`, con `integration: "WHATSAPP-BUSINESS"`, `token`/`number`/`businessId` del número de prueba.
3. Apuntar su webhook al mismo `evolution_exchange` (o, si se prefiere no arriesgar la cola real, a una cola de prueba `q.wsp.spike` con un binding temporal — el exchange ya es `topic`, así que es un binding más sin tocar nada existente).
4. Mandar por WhatsApp, contra el número de prueba: texto, imagen con caption, audio, documento, ubicación, un contacto y (si Meta lo permite en modo test) una plantilla.
5. Comparar el payload crudo recibido contra lo que documenta [n8n-normalizacion-wsp-messages.md](n8n-normalizacion-wsp-messages.md) para cada tipo.

**Listo cuando:** hay una carpeta de fixtures con los payloads reales de la instancia Business, y una tabla "coincide / no coincide" contra la forma que espera hoy `Switch Control type`.

**Esta etapa decide el tamaño real de las etapas 1 y 2** — si coincide todo, son horas; si no, son días.

### Etapa 1 — Ajustar n8n según lo que salió del spike

Sobre `rag.json` (ver [docs/n8n-normalizacion-wsp-messages.md](n8n-normalizacion-wsp-messages.md) como referencia del estado actual):

- Si los campos coinciden: nada que tocar en `Switch Control type` ni en los nodos `* content*`.
- Si no coinciden (caso más probable para algo como `templateMessage`/`interactiveMessageTemplate`, que en Meta nativo tiene forma de `interactive`/`template` distinta a la de Baileys): añadir las reglas que falten al `Switch Control type`, siguiendo el mismo patrón por el que ya se agregaron `locationMessage`, `pollCreationMessage`, `liveLocationMessage`, etc.
- Revisar en particular **`contact content`**: la extracción de teléfono hoy parsea el `vcard` de Baileys (`waid=`, `TEL`) — si Meta entrega contactos con otra forma, ese parser necesita una rama nueva.
- El estado de mensajes (`MESSAGES_UPDATE` → `q.wsp.status` → `/api/webhooks/message-status`) usa códigos numéricos de Baileys (2–5); confirmar si Evolution normaliza el status de Cloud API (`sent`/`delivered`/`read`/`failed`) a los mismos códigos o si `message_status_service.py` necesita una rama nueva.

**Listo cuando:** los 7-8 tipos de mensaje de la Etapa 0 producen las mismas columnas en `wsp_messages` que producirían viniendo de Baileys.

### Etapa 2 — Backend: identidad y ventana de 24 h

1. **Identidad.** No se necesita código nuevo si el spike confirma que Evolution entrega `remoteJid` con sufijo `@s.whatsapp.net` — `parse_evolution_identity` y `resolve_whatsapp_identity` ya tratan cualquier JID sin sufijo `@lid` como `kind='phone'` sin rama especial. Sí hay que **documentar** que para instancias Business, `resolve_history_jid` y `aliases_from_send_key` (pensados para el caso `@lid`) son no-ops benignos, no bugs.
2. **Ventana de 24 h.** Punto nuevo que no existe hoy: el composer del frontend permite texto libre siempre. Hace falta:
   - Que el backend sepa, por chat, si está dentro de la ventana (último mensaje entrante hace < 24 h) — dato derivable de `wsp_messages`, no requiere columna nueva.
   - Que `send_whatsapp_text` rechace con un error claro (no un 500 genérico) si la instancia es Business y la ventana está cerrada, para que el frontend pueda ofrecer "mandar plantilla" en lugar de fallar en silencio.
   - Esto es exclusivamente para instancias `WHATSAPP-BUSINESS`; una instancia Baileys sigue sin esta restricción.
3. **Capacidades por instancia.** `get_template_capabilities()` ya distingue Baileys de Business para plantillas; conviene generalizarlo a un solo `get_instance_capabilities()` que además reporte `history_available` y `edit_delete_supported`, para que el frontend oculte los botones de editar/borrar y el buscador de historial retroactivo cuando la instancia activa es Business, en vez de dejarlos fallar al usarlos.

### Etapa 3 — RabbitMQ / ingesta

Si el spike confirma que Evolution emite el mismo evento `messages.upsert` sobre el mismo `evolution_exchange`, **no hay nada que tocar** en [mq/definitions.json](../mq/definitions.json) ni en `mq/provision.sh`: la instancia Business publica con las mismas routing keys, y `q.wsp.inbound` ya está atada a ellas sin filtrar por instancia.

Único punto a confirmar: el `groupsIgnore` y las colas huérfanas de Evolution en modo global (`RABBITMQ_GLOBAL_ENABLED=true`) — confirmar que aplican igual a una instancia Business o si el modo Business tiene su propio comportamiento de colas globales.

### Etapa 4 — Encaje con el pivot multi-tenant

Esto es lo que conecta con `multi-tenant-saas-plan.md`: hoy la Etapa 2 de ese
plan asume "cada org vincula su WhatsApp por QR" (Baileys). Con Tech Provider
ya verificado, conviene **reemplazar esa etapa** por Embedded Signup:

- El "provisioning al vincular" deja de ser `POST /instance/create` con QR y
  pasa a ser: el usuario completa el signup embebido de Meta en el frontend →
  la app recibe `waba_id`/`phone_number_id`/`access_token` → se crea la
  instancia de Evolution con `integration: WHATSAPP-BUSINESS` y esas
  credenciales → se registra el webhook de esa instancia contra el mismo
  `evolution_exchange`.
- No hace falta decidir esto ahora mismo, pero si se confirma, la Etapa 2 del
  plan multi-tenant se simplifica: no hay pantalla de QR ni polling de estado
  de conexión, es un callback de OAuth.

**Recomendación:** usar Meta Cloud API como el camino de onboarding para
**organizaciones nuevas** del modelo multi-tenant, y decidir aparte (Etapa 5)
si el número de producción actual migra o queda en Baileys.

### Etapa 5 — Migración del número de producción (la más riesgosa, al final)

Recién después de que las etapas 0-3 estén validadas con un número de prueba:

1. Confirmar con Meta si el número actual puede registrarse en Cloud API
   manteniendo el historial de WhatsApp del lado del cliente (el historial del
   CRM en Postgres no se pierde nunca; lo que no se puede traer es lo que
   Evolution podría haber sincronizado retroactivamente de Baileys).
2. Registrar el número vía el flujo oficial de Meta (verificación SMS/voz).
   **Punto sin retorno:** una vez migrado a Cloud API, ese número deja de
   poder usarse desde la app de WhatsApp normal salvo que se use el feature de
   coexistencia de Meta (requiere la app oficial de WhatsApp Business, no
   Baileys) — confirmar disponibilidad y alcance exacto en ese momento, no
   asumirlo de este documento.
3. Ventana de corte: apagar la instancia Baileys, crear la instancia Business
   con las credenciales del número migrado, verificar que entra tráfico real
   por `q.wsp.inbound` antes de anunciar el cambio a los vendedores.
4. Comunicar a los vendedores, **antes** del corte: pierden edición/borrado de
   mensajes propios, y fuera de la ventana de 24 h el primer mensaje a un lead
   frío tiene que ser una plantilla aprobada, no texto libre.

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El supuesto de la sección 2 no se cumple y el payload de Business es distinto | Etapa 0 lo detecta antes de tocar nada real; el costo de estar equivocado se paga en fixtures, no en producción |
| Se pierde la capacidad de editar/borrar mensajes que los vendedores ya usan | Comunicar antes del corte (Etapa 5.4); ocultar los botones para instancias Business (Etapa 2.3) en vez de dejarlos fallar |
| Un vendedor intenta escribir a un lead frío fuera de la ventana de 24 h y el mensaje falla en silencio | Backend devuelve error explícito + frontend ofrece plantilla (Etapa 2.2) |
| El número de producción queda inutilizable en la app normal de WhatsApp tras migrar | Confirmar coexistencia con Meta antes de la Etapa 5; hasta entonces, todo el spike corre sobre un número de prueba nuevo, nunca el de producción |
| Las colas huérfanas / `groupsIgnore` de Evolution se comportan distinto en modo Business | Validar en la Etapa 3 antes de asumir que la topología de RabbitMQ no cambia |

## 6. Qué NO hace falta tocar

- El outbox transaccional (`message_outbox.py`) y su modelo de idempotencia:
  siguen funcionando igual, sea Baileys o Business, porque el POST a Evolution
  no cambia de forma.
- La ingesta de acuses de estado por `q.wsp.status`, salvo la posible
  normalización de códigos mencionada en la Etapa 1.
- Nada del plan de [rabbitmq-eventos-plan.md](rabbitmq-eventos-plan.md) (mover
  la persistencia al backend): es ortogonal a este cambio y puede avanzar en
  paralelo o después, sin que uno bloquee al otro.
