# Plan de refactorización: integración nativa con Meta Cloud API

**Estado:** propuesto  
**Fecha:** 2026-09-24  
**Alcance:** recepción, persistencia, envío, identidad, estados, frontend, IA, automatizaciones, migraciones y retiro total de Evolution/Baileys.

## 1. Objetivo

Dejar el CRM integrado directamente con Meta WhatsApp Cloud API, sin traducir sus mensajes al modelo de Evolution o Baileys.

Los tipos, subtipos, estados, identificadores y payloads de Meta deben:

- conservar sus nombres y estructuras originales;
- almacenarse antes de cualquier proyección para la interfaz;
- utilizarse como fuente canónica del historial;
- aceptar todos los mensajes entrantes documentados;
- permitir en salida solamente mensajes que Meta autoriza enviar;
- mantener compatibilidad futura sin convertir tipos desconocidos a `unsupported`.

## 2. Decisión sobre `button`

`button` no es un tipo raíz enviable. Para enviar botones se usa:

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button"
  }
}
```

Sin embargo, Meta sí entrega `button` como tipo raíz de entrada cuando un usuario pulsa una respuesta rápida de una plantilla:

```json
{
  "type": "button",
  "button": {
    "text": "OpcionA",
    "payload": "OpcionA"
  }
}
```

Una respuesta a un botón interactivo tiene otra forma:

```json
{
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": {
      "id": "opcion_a",
      "title": "OpcionA"
    }
  }
}
```

Por lo tanto:

- `button` se conserva como raíz exclusivamente en entrada para quick replies de plantillas;
- `interactive/button` se usa exclusivamente para el mensaje interactivo saliente;
- `interactive/button_reply` se conserva como respuesta entrante a ese interactivo;
- estos casos no se fusionan ni se normalizan.

Referencia: [callback oficial de un quick reply de plantilla](https://www.postman.com/meta/whatsapp-business-platform/request/5qal58f/received-callback-from-a-quick-reply-button-click).

## 3. Contrato objetivo de mensajes

### 3.1 Tipos raíz

| Dirección | Tipos raíz almacenados literalmente |
|---|---|
| Entrada | `text`, `image`, `video`, `audio`, `document`, `sticker`, `location`, `contacts`, `reaction`, `interactive`, `button`, `order`, `system`, `unknown`, `unsupported` |
| Salida | `text`, `image`, `video`, `audio`, `document`, `sticker`, `location`, `contacts`, `reaction`, `interactive`, `template` |

La lista de salida corresponde a la unión publicada en el [OpenAPI oficial de Meta](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml#L2042-L2068).

Cambios frente al modelo actual:

- `contact` pasa a `contacts`.
- Se eliminan como raíces activas `ptv`, `poll`, `pin`, `product`, `payment` y `view_once`.
- `product` pasa a ser subtipo de `interactive`.
- `button` deja de ser una raíz genérica o enviable; permanece solo en el caso de entrada que Meta define.
- `unsupported` y `unknown` se guardan únicamente si Meta envía literalmente esos valores.
- Un valor nuevo no reconocido se conserva tal cual y no se transforma en `unsupported`.

### 3.2 Subtipos de `interactive`

| Dirección | Subtipos |
|---|---|
| Salida | `button`, `list`, `product`, `product_list`, `catalog_message`, `flow`, `call_permission_request` |
| Entrada | `button_reply`, `list_reply`, `nfm_reply` |

Los subtipos salientes están enumerados en el [OpenAPI oficial de Meta](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml#L2246-L2263). `nfm_reply` se conserva para las respuestas de WhatsApp Flows.

El contrato debe quedar versionado. Cuando Meta incorpore un tipo o subtipo, el webhook debe conservar el valor y payload originales aunque todavía no exista un renderer especializado.

## 4. Principios de arquitectura

### 4.1 Persistencia fiel al proveedor

La información canónica es lo que Meta envió o lo que el CRM envió a Meta. Las proyecciones de texto, preview o búsqueda no deben reemplazar el payload original.

### 4.2 Contratos separados por dirección

Entrada y salida no compartirán una allowlist indiferenciada. Un tipo puede ser válido solo en una dirección.

### 4.3 Sin aliases de Evolution

No se transformará:

- `contacts` en `contact`;
- `sent` en `SERVER_ACK`;
- `delivered` en `DELIVERY_ACK`;
- `failed` en `REJECTED`;
- un teléfono en `@s.whatsapp.net`;
- un identificador Meta en `@lid`;
- un tipo desconocido en `unsupported`.

### 4.4 Compatibilidad futura

La base no debe impedir guardar nuevos valores de Meta. El registro de tipos conocidos servirá para validación y renderizado, no para descartar datos.

## 5. Modelo de datos objetivo

La tabla de mensajes debe separar los datos canónicos de las proyecciones para la interfaz.

Campos principales:

- `message_type`: valor literal de `messages[].type`.
- `message_subtype`: valor literal de `interactive.type` o subtipo equivalente.
- `provider_payload`: objeto completo de mensaje recibido o cuerpo exacto enviado.
- `webhook_event_id`: referencia al evento crudo que originó el mensaje.
- `direction`: `inbound` o `outbound`.
- `wa_message_id`: identificador literal de Meta.
- `content`, `media_url`, dimensiones y resumen: proyecciones derivadas para UI y búsqueda.

No se debe mantener un `CHECK` cerrado sobre `message_type`. La aplicación tendrá una lista de valores conocidos, pero la base permitirá conservar tipos futuros.

### 5.1 Estados

Se separarán los estados internos de los reportados por Meta:

- `outbox_status`: `queued`, `sending`, `retryable_failed`, `discarded` u otros estados internos.
- `meta_status`: valor literal informado por Meta, como `sent`, `delivered`, `read` o `failed`.
- `status_payload`: evento completo, incluyendo errores, pricing y conversation cuando existan.

Cada cambio de estado se conservará como evento para soportar entregas duplicadas o fuera de orden. Se eliminará la traducción a estados de Evolution como `SERVER_ACK`, `DELIVERY_ACK` y `REJECTED`.

Referencia: [estados oficiales de webhook](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference).

## 6. Plan de implementación

### Fase 1. Contrato y fixtures oficiales

Crear una definición única del contrato Meta:

- raíces permitidas en entrada;
- raíces permitidas en salida;
- subtipos por dirección;
- restricciones de cada subtipo;
- capacidades condicionadas por cuenta;
- fixtures JSON para cada raíz y subtipo;
- pruebas de igualdad entre payload recibido y payload persistido.

Este contrato sustituirá las listas duplicadas en backend y frontend.

### Fase 2. Migración aditiva de base de datos

Agregar, sin retirar todavía las columnas anteriores:

- `message_subtype`;
- `provider_payload`;
- `direction`;
- estado Meta separado del outbox;
- identificadores Meta sin JID;
- tabla o referencia de eventos de estado.

Ejecutar un backfill basado exclusivamente en evidencia del payload:

- convertir `contact` a `contacts` solo cuando el payload demuestre que era un contacto Meta;
- conservar una fila `button` si el mensaje original tiene `type: "button"`;
- convertir a `interactive` y extraer el subtipo si el payload original tiene `type: "interactive"`;
- recuperar filas `unsupported` solo si el tipo original está presente en el payload;
- no inventar una representación Meta para filas exclusivamente Evolution.

Los datos históricos que no puedan reconstruirse fielmente se exportarán a un archivo o tabla de solo lectura antes de retirar el modelo anterior.

La migración provisional que agregó `button` debe revisarse para evitar clasificar como raíz respuestas que realmente sean `interactive/button_reply`.

### Fase 3. Ingesta cruda del webhook

Flujo objetivo:

```text
Meta -> verificación HMAC -> persistencia cruda -> deduplicación
     -> parser por raíz -> proyecciones -> eventos del CRM
```

Tareas:

- almacenar el webhook crudo antes de transformarlo;
- mover el parser de mensajes al backend;
- retirar del workflow n8n la fabricación de JID, aliases y tipos normalizados;
- implementar un handler explícito para cada raíz entrante;
- implementar `button_reply`, `list_reply` y `nfm_reply`;
- procesar `order` con sus productos, cantidades, precios y moneda originales;
- conservar mensajes `system` y sus subtipos;
- conservar `context`, `referral`, `identity`, `referred_product` y errores;
- conservar `reaction` como evento Meta canónico y derivar el badge de la UI;
- importar medios sin modificar el objeto que los describe;
- guardar y alertar un tipo desconocido sin renombrarlo.

El nodo `normalizar eventos Meta` debe desaparecer. Si n8n continúa en la ruta, solo transportará el webhook sin modificarlo. El objetivo preferido es Meta conectado directamente al endpoint del backend.

### Fase 4. Salida estrictamente permitida por Meta

Crear una única allowlist utilizada por:

- DTOs de API;
- endpoints;
- outbox;
- dispatcher;
- frontend.

Cada builder debe generar exactamente la estructura Meta:

- raíces simples: texto, medios, ubicación, contactos, sticker y reacción;
- plantillas mediante `type: "template"`;
- interactivos mediante `type: "interactive"` y subtipo literal.

Cambios adicionales:

- renombrar el subtipo interno `buttons` a `button`;
- eliminar fallbacks que convierten un interactivo no soportado en texto;
- devolver `422` antes de crear el outbox si el tipo no puede enviarse;
- revalidar en el worker para impedir que jobs antiguos envíen formas inválidas.

Capacidades condicionadas:

- `product`, `product_list` y `catalog_message`: requieren catálogo configurado;
- `flow`: requiere Flow publicado y configurado;
- `call_permission_request`: requiere capacidad de la cuenta y versión de API;
- `template`: requiere plantilla aprobada y activa;
- mensajes libres: requieren ventana de atención abierta cuando corresponda.

No se crearán salidas para `button`, `order`, `system`, `unknown` o `unsupported`.

### Fase 5. Identidad Meta y retiro de JID

La identidad se basará en valores Meta exactos:

- `phone_number_id`;
- `wa_id`;
- `user_id` u otro identificador entregado por Meta;
- `display_phone_number` solo como dato de presentación;
- `lead_id` como relación interna.

Eliminar:

- generación de `@s.whatsapp.net`;
- generación y resolución de `@lid`;
- `remote_jid`;
- aprendizaje de aliases Baileys;
- `message_secret`;
- selección de instancia Evolution;
- lectura de historial desde Evolution;
- fallbacks de conexión y QR de Evolution.

Los sufijos históricos no se retirarán a ciegas. Primero se cruzarán con payloads Meta y leads existentes para evitar fusiones incorrectas.

### Fase 6. Frontend, lista y detalle del chat

Renderizar por `message_type + message_subtype`, leyendo la estructura Meta:

- `contacts` con todos sus contactos y campos;
- `button` de plantilla con texto y payload;
- `interactive/button_reply`;
- `interactive/list_reply`;
- `interactive/nfm_reply` con datos del Flow;
- `order` con productos, cantidades, precios y moneda;
- `system` como evento informativo;
- `unknown` y `unsupported` con datos y errores disponibles;
- consultas de producto como `text` con `context.referred_product`;
- interactivos salientes de catálogo, productos, Flow y llamada.

Eliminar:

- parsers de pseudo-tags;
- formatos `interactiveMessageTemplate`, `selectedDisplayText` y otras formas Evolution;
- fallback automático a `unsupported`;
- tipos y comentarios Evolution del frontend;
- `buttons` como nombre de subtipo.

El caso de regresión `OpcionA` debe quedar cubierto: el resumen de la lista y el cuerpo del chat usarán el mismo contrato y el mensaje será visible en ambos lugares.

### Fase 7. IA y automatizaciones

- Entregar a la IA `message_type`, `message_subtype` y una proyección de texto, conservando el payload estructurado.
- Evitar que `system`, `reaction` o estados sean tratados como frases del cliente.
- Permitir reglas sobre `button.payload`, `button_reply.id`, `list_reply.id`, `nfm_reply` y pedidos.
- Migrar reglas basadas en texto plano solo cuando el dato original permita una conversión inequívoca.
- Aplicar a las respuestas sugeridas la misma allowlist del dispatcher.

### Fase 8. Eliminación total de Evolution

Tras completar el cutover, retirar:

- `backend/services/evolution_service.py`;
- `backend/services/evolution_channel.py`;
- `backend/services/whatsapp_history/`;
- fallbacks Evolution de canales y conexión;
- configuración `evolution_api_url`, `evolution_api_key` y `evolution_instance`;
- rutas QR/connect/disconnect heredadas;
- scripts de diagnóstico, sincronización y merge basados en JID;
- documentación y pruebas Evolution;
- inicialización y cierre del cliente Evolution;
- comentarios y nombres internos relacionados con Evolution o Baileys.

La comprobación final será una búsqueda global sin referencias activas a:

- `Evolution`;
- `Baileys`;
- `remote_jid`;
- `@lid`;
- `@s.whatsapp.net`;
- `SERVER_ACK`;
- `DELIVERY_ACK`.

Las únicas referencias históricas permitidas durante la migración estarán en scripts o archivos de archivo con fecha de retiro definida. Al finalizar, también se eliminarán.

### Fase 9. Pruebas, despliegue y retiro del modelo anterior

Orden de entrega:

1. Contrato y esquema aditivo.
2. Webhook crudo y parser Meta.
3. Renderers completos de entrada.
4. Builders y UI de salida.
5. Identidad y estados Meta.
6. Backfill auditado.
7. Cambio definitivo del webhook.
8. Eliminación de Evolution y columnas antiguas.

Pruebas obligatorias:

- fixture para cada raíz entrante;
- fixture para cada subtipo interactivo;
- igualdad exacta entre payload recibido y almacenado;
- pruebas negativas para cada raíz o subtipo no enviable;
- deduplicación y replay de webhooks;
- estados duplicados y fuera de orden;
- medios, reacciones, pedidos, sistema, Flow y quick replies;
- migración idempotente con conteos antes y después;
- E2E con el número de prueba de Meta;
- regresión de `OpcionA` visible en lista y detalle.

## 7. Observabilidad

Agregar métricas y alertas para:

- tipo o subtipo Meta todavía sin renderer;
- webhook rechazado por firma;
- evento duplicado;
- mensaje no asociado a un lead;
- error al descargar medios;
- rechazo de salida por capacidad o ventana;
- error devuelto por Meta;
- diferencia entre el payload enviado y el registrado en outbox.

Un tipo desconocido debe ser un evento observable, no una pérdida de datos.

## 8. Criterios de aceptación

La refactorización queda completa cuando:

- la base guarda `message_type`, `message_subtype` y payload Meta sin traducción;
- `button` funciona correctamente en sus dos formas distintas;
- todos los tipos entrantes tienen almacenamiento y representación;
- solo se ofrecen salidas aceptadas por Meta;
- no existen JID sintéticos ni estados Evolution;
- no queda dependencia activa de Evolution para historial, conexión, envío o identidad;
- un tipo futuro se conserva literalmente y genera una alerta;
- lista, chat, IA y automatizaciones consumen el mismo contrato;
- el mensaje `OpcionA` aparece tanto en la lista de conversaciones como dentro del chat.

## 9. Fuentes oficiales

- [Documentación de envío de mensajes de WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages#message-types)
- [OpenAPI oficial de Meta para Business Messaging](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml)
- [Objeto de mensajes entrantes](https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object)
- [Callback de quick reply de plantilla](https://www.postman.com/meta/whatsapp-business-platform/request/5qal58f/received-callback-from-a-quick-reply-button-click)
- [Envío oficial de reply buttons](https://www.postman.com/meta/whatsapp-business-platform/request/x0kd1at/send-reply-button)
- [Referencia de webhooks y estados](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference)
- [Herramientas oficiales de WhatsApp Flows](https://github.com/WhatsApp/WhatsApp-Flows-Tools)

## 10. Registro de implementación

Rama: `refactor/meta-cloud-api-nativa`. Se implementa en el orden de la Fase 9
y cada fase cierra con un commit y la suite en verde.

### 10.1 Decisiones

- **Contrato único.** `backend/contracts/meta_messages.json` es la fuente.
  El backend lo lee en `services/meta_contract.py`; el frontend usa
  `frontend/src/domain/metaContract.ts`, generado con
  `python -m scripts.export_meta_contract` y verificado por un test.
- **Webhook directo.** Meta apunta a `GET/POST /api/webhooks/meta/whatsapp`.
  El POST verifica la firma HMAC sobre el cuerpo crudo, guarda cada `change`
  sin tocar en `public.webhook_inbox`, responde 200 y un worker global lo
  procesa. n8n deja la ruta de mensajes; si se lo mantiene delante, el
  workflow queda como relay que reenvía cuerpo y firma sin modificarlos.
- **Mensajes.** `wsp_messages` suma `message_subtype`, `provider_payload`
  (mensaje recibido o cuerpo exacto enviado), `webhook_event_id`,
  `direction` (columna generada desde `sender`), `outbox_status`,
  `meta_status` y `status_payload`. Se elimina el `CHECK` sobre
  `message_type`. `payload` queda solo como proyección para la UI (anuncio
  rehospedado, datos de plantilla que el cuerpo enviado no trae).
- **Eventos.** `whatsapp_message_events` guarda cada estado y cada reacción
  tal como llegan. `meta_status` y el badge `reactions` se derivan de ahí.
- **Identidad.** `whatsapp_identities` pasa a `(phone_number_id, identifier,
  kind)` con `kind` en `wa_id`/`user_id`. Los alias con sufijo se convierten
  solo con evidencia; lo demás se archiva en `archived_whatsapp_identities`.
- **Salida.** El outbox guarda el cuerpo Meta (sin `to` ni ids de medios) y
  el worker lo completa, lo revalida contra la allowlist y registra en
  `provider_payload` exactamente lo que envió.

### 10.2 Avance

- [x] 1. Contrato y esquema aditivo
- [x] 2. Webhook crudo, parser Meta e identidad sin JID
- [x] 3. Renderers completos de entrada (un renderer por raíz y por subtipo
  interactivo; un tipo nuevo se muestra con su nombre literal)
- [x] 4. Builders y UI de salida (allowlist única en `meta_outbound.py`;
  producto, lista de productos, catálogo, Flow y permiso de llamada desde el
  menú de adjuntos, solo si la cuenta los tiene habilitados)
- [x] 5. Estados Meta separados del outbox (`outbox_status` y `meta_status`)
- [x] 6. Backfill auditado (migración c7e2f9a4d1b8, con `archived_wsp_messages`)
- [x] 7. IA y automatizaciones sobre el contrato (condiciones
  `reply_id_equals` y `message_type_equals` en el constructor de flujos)
- [x] 8. Cambio definitivo del webhook y retiro de Evolution

### 10.3 Pendiente fuera de esta rama

- El stack de RabbitMQ (`compose.mq.yml`, `mq/`, el bloque de despliegue en
  CI y su monitoreo) existía para la ingesta de Evolution y ya no recibe
  mensajes. Se retira en un cambio aparte para no mezclarlo con el refactor.
- Los documentos fechados de `docs/analisis` quedan como registro histórico.
