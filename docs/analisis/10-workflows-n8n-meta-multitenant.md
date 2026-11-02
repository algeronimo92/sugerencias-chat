# Análisis de workflows n8n: Meta y agentes a demanda

Revisión: 2026-09-17. Complementa el [plan multi-tenant](../multi-tenant-saas-plan.md#7-webhooks-n8n-y-whatsapp).

## Alcance y evidencia

Se inspeccionaron nodos, conexiones principales, herramientas IA, consultas SQL,
expresiones y contratos HTTP de los exports **locales** `rag.json` (104 nodos),
`analista.json` (19) y `webhook meta cloud api.json` (22, incluida una nota).
No se consultó la instancia n8n desplegada. `active: true` dentro de un export
no confirma su publicación ni sus callers reales.

Los exports están excluidos por `.gitignore` y contienen configuración sensible
y datos de ejemplo reales. Este documento registra estructura y hallazgos sin
copiar credenciales ni pinData. Los antiguos exports de Evolution, estados y
borrados no están presentes en esta revisión; no se presupone su uso actual.

La intención confirmada es **Meta → webhook n8n → backend**, con `rag` y
`analista` como subworkflows independientes a demanda, y un schema por negocio.

## 1. Para qué sirve cada workflow hoy

### Webhook Meta: recepción y persistencia

```text
GET → verificar token → challenge / rechazo

POST → responder 200 → normalizar → etiquetar ejecución → tipo de evento
  mensaje → resolver identidad → asegurar lead → buscar duplicado
    nuevo → importar medio si corresponde → guardar → avisar al backend
    existente → termina
  estado → actualizar estado
  reacción → resolver identidad → guardar reacción
```

Normaliza texto, imagen, video, audio, sticker, documento, ubicación, contacto,
respuestas interactivas/botones y datos de referral publicitario. Los tipos no
reconocidos se representan como unsupported. Esto no implica paridad completa
con todas las operaciones de Evolution: se debe validar cada evento usado.

Todos sus accesos al CRM pasan por HTTP. `/meta-media` importa el archivo desde
Meta; no lo transcribe ni describe con IA. `avisar al backend` llama
`/api/webhooks/messages`, que publica cambios y dispara las automatizaciones
de entrada del backend. El grafo exportado **no llama a rag ni a analista**.

La identidad se adapta a un cuerpo con `instance/data/key/remoteJid`, parecido
al contrato Evolution del backend. Eso es compatibilidad de formato; no es una
llamada a Evolution. El problema para multi-tenant es que utiliza una instancia
fija y pierde el identificador real del número Meta.

### RAG: copiloto más varias responsabilidades heredadas

| Entrada/rama | Trabajo real |
|---|---|
| `Webhook1` GET | Lee lead e historial, prepara recursos y ejecuta `Agente Copiloto Ventas1`; responde al solicitante con sugerencias |
| `When Executed by Another Workflow` | Entra por `Backend URLs (EWT)` a resolución de identidad y procesamiento de mensajes Evolution |
| `Webhook4` POST | Parsea contenido/medios y desemboca en la rama común de persistencia entrante/saliente |
| `Code in JavaScript1 → Supabase Vector Store1` | Inserta documentos de conocimiento; no hay camino desde los disparadores a esta rama |

El copiloto asesora al vendedor: propone textos, tácticas, motivos y adjuntos.
Su prompt dice que no escribe al cliente ni determina la etapa. Su salida incluye
`analisis`, `confianza`, `senal_compra`, `alerta` y hasta tres sugerencias.
Consume historial, datos del lead e `instruction` del asesor. Usa:

- `RAG1`: herramienta Supabase sobre `documents`, topK 5, sin filtro tenant
  configurado en el nodo.
- `precios1`: catálogo HTTP fijo de DermicaPro.
- Recursos, servicios y reglas particulares de DermicaPro dentro de prompts.

La rama legacy reconoce numerosos tipos de mensaje, llama a
`/chat/getBase64FromMediaMessage/{instance}` de Evolution en sus rutas de descarga,
convierte archivos, analiza determinados adjuntos con Gemini y sube medios al
backend. Algunas ramas aceptan binarios ya disponibles. Diferencia vendedor y
cliente y desemboca en guardado/actualización entrante o saliente.

`guardar mensajes en posgress` tiene nombre heredado: **es un nodo HTTP**, no
Postgres. Después de guardar, la rama entrante avisa al backend y llama
`analista`; también llama al analista cuando el mensaje ya existía.
`Call analista` tiene `waitForSubWorkflow: false`.

Existe además una llamada condicional a `pixel lead` al detectar
`externalAdReply`. Otro nodo referencia `SUB - save CTWA`, pero no tiene
camino desde los disparadores inspeccionados. Esos subworkflows no están
exportados aquí: inventariarlos antes de retirar la rama legacy para conservar
atribución y conversiones sin duplicarlas.

**Consecuencia:** invocar hoy el workflow RAG mediante Execute Sub-workflow
entra en ingesta Evolution, no en el copiloto. La extracción del copiloto debe
cambiar el disparador, sus referencias a `Webhook1` y el retorno.

### Analista: clasificación y actualización del lead

```text
Datos del mensaje (Execute Sub-workflow Trigger)
  → espera → consulta último mensaje → ¿coincide con message_id recibido?
    no → termina
    sí → consulta historial + lead → actualiza actividad
       → agente analista → normaliza salida
       → UPDATE de campos del lead → HTTP lead-stage
```

Clasifica etapa, objeción e interés, extrae nombre/teléfono/notas y datos de
seguimiento/cita. No es el generador de respuestas del vendedor.

La espera exporta `amount: 15` sin unidad explícita. Confirmar la unidad en la
versión instalada y declararla al refactorizar; no asumir que son 15 segundos.
La condición de último mensaje evita algunas ejecuciones viejas antes de llamar
al modelo, pero no protege la escritura al finalizar.

Sus cinco nodos Postgres son `ultimo mensaje1`, `get messages1`,
`get lead4`, `update lead4` y `update lead`. Los nodos tabulares seleccionan
`public.leads`; las consultas de mensajes usan `wsp_messages` sin schema.
Ninguno obtiene contexto de negocio autorizado.

## 2. Problemas concretos y corrección requerida

| Hallazgo | Evidencia / efecto | Corrección del plan |
|---|---|---|
| Tenant perdido en Meta | Normalizador fija instancia; no propaga `metadata.phone_number_id` | Conservar número por change/ítem y resolver conexión en backend antes de todo acceso |
| Perfil Meta frágil | Acceso directo a `value.contacts[0].profile.username` | Resolver contacto por `msg.from`, encadenamiento seguro y null real |
| ACK anterior al procesamiento | `responder 200` precede normalización y guardado | Confirmar inbox/cola durable antes del ACK; replay posterior independiente |
| Fallo después de insertar | Un duplicado termina antes de `avisar al backend` | Mensaje + outbox atómicos; reintentar efectos pendientes, no solo INSERT |
| Autenticidad POST no visible | Export verifica challenge GET, sin validación de firma POST observada | Comprobar ingress real y cubrir validación sobre cuerpo original antes de ACK |
| SQL del analista | Tres nodos apuntan a `public.leads`, dos consultan mensajes | Sustituir por APIs autorizadas; sin acceso a schemas desde n8n |
| Versión y pausa sobrescritas | Ambos UPDATE fijan versión 0; `update lead4` fija pausa false | Propiedad exclusiva del backend; analista no modifica esos controles |
| Fecha de actividad inconsistente | UPDATE usa `data[0].created_at`, SELECT ofrece `sent_at` | Usar contrato explícito y actualizar actividad durante ingesta |
| Resultado IA obsoleto | Solo se comprueba último mensaje antes de generar | Aplicación atómica condicionada a revisión de contexto/lead aún vigente |
| Conocimiento compartido | Supabase `documents` sin filtro en lectura y sin tenant en metadata de carga | Recuperación/indexación autorizadas; tablas de conocimiento por schema |
| Configuración de un negocio | Hosts, catálogo, políticas y reglas telefónicas fijos | Configuración por tenant proporcionada por backend |
| Cobertura de tests incompleta | Test contractual busca `docs/rag*.json` y tolera nombres SQL legacy | Fixtures sanitizadas de todos los workflows activos y contratos de aislamiento |

Los nodos HTTP de Meta sí tienen retry configurado. Eso no equivale a una
garantía durable de procesamiento completo tras devolver 200. También existe
`chat_watcher` como respaldo de notificaciones en el backend; no reemplaza un
registro persistente de recepción y efectos pendientes.

La opción Raw Body del nodo Webhook permite conservar el cuerpo recibido para
la validación que se implemente. Ver [documentación del nodo Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook).

## 3. Migrar el analista a HTTP exige paridad de contrato

Los endpoints ya existen, pero no basta con cambiar el tipo de nodo:

| Nodo | API existente | Diferencia a resolver |
|---|---|---|
| `get lead4` | `GET /lead-raw` | Añadir autorización/contexto tenant y mantener forma de datos |
| `get messages1` | `GET /lead-messages-raw` | Conservar orden, límite y enriquecimiento de content con analysis.summary |
| `ultimo mensaje1` | `GET /last-message-raw` | La API omite mensajes sin wa_message_id; el SQL actual no. Definir cursor consistente |
| `update lead4` | `POST /lead-inbound-activity` | Sacar del trabajo IA; conservar emisor/fecha y eliminar reset de pausa/versión |
| `update lead` | `POST /lead-analysis` | Faltan campos, semántica de null y comprobación de revisión |

En [webhook_schemas.py](../../backend/models/webhook_schemas.py),
`LeadAnalysisWebhookBody` no incluye `proxima_cita` ni `con_especialista`,
que sí escribe el export. En
[leads.py](../../backend/routers/webhooks/leads.py), `lead-analysis` usa
`exclude_none=True`: un null explícito no limpia el valor, mientras el analista
normaliza sentinelas a null antes del UPDATE.

Acordar semántica por campo: ausente conserva; null explícito limpia solo campos
que admiten limpieza y para los que hay evidencia. No tratar falta de información
como orden universal de borrado. Validar fechas y preservar invariantes de citas
y automatizaciones. `lead-stage` sigue pasando por el servicio que audita y
programa automatizaciones; aplicar campos y etapa con coordinación e idempotencia
para no dejar actualizaciones parciales ni disparos repetidos.

La comprobación de vigencia debe cubrir mensajes nuevos, resultados IA y
ediciones humanas durante la ejecución. Crear una revisión específica del
contexto; la `conversacion_version` del backend identifica el ciclo de conversación,
no todos sus cambios.

## 4. Diseño de invocación a demanda

```text
Web del negocio → API con sesión/tenant → job autorizado → despacho n8n
                                                    ├→ rag → sugerencias
                                                    └→ analista → propuesta de actualización
Resultado → backend valida job + revisión → persiste/audita → WebSocket del tenant
```

El origen puede ser una acción del asesor o una regla explícita habilitada para
el negocio. Recibir un mensaje no obliga a invocar ninguno de los dos. Son
operaciones independientes: no encadenar siempre analista detrás de RAG.

La API actual de sugerencias ya distingue lectura de cache (GET) y generación
(POST, con cache salvo fuerza/instrucción). Su servicio n8n llama un webhook GET
con `chat_id`, `refresh` e `instruction` y espera `[{"output": {...}}]`.
Conservar ese adaptador mientras se extrae el núcleo como subworkflow, añadiendo
el job autorizado; o cambiar ambos contratos coordinadamente. No devolver un
resultado asíncrono al cliente síncrono actual.

El subworkflow debe recibir inputs definidos y devolver datos mediante su nodo
final; el workflow externo maneja HTTP. Para esperar resultados se configura
Wait for Sub-Workflow Completion. Ver
[n8n Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow).

Para medios, extraer un subworkflow de transcripción/descripción si se desea
conservarlo. Trabaja sobre un mensaje/archivo ya registrado y autorizado, sin
instancia Evolution ni descarga desde una URL elegida por el payload. Un fallo
de IA no puede impedir que se vea el mensaje original.

## 5. Orden y verificación antes del segundo negocio

1. Confirmar exports desplegados, callers de las tres entradas de RAG y
   subworkflows de publicidad. Versionar solo fixtures sanitizadas.
2. Corregir normalizador Meta, autenticidad y recepción durable con replay.
3. Implementar resolución conexión → tenant y APIs scoped, incluida importación
   de medios; persistencia + outbox y actividad independientes de los agentes.
4. Extraer copiloto, retirar SQL del analista tras completar paridad de contrato
   y crear dispatcher/jobs a demanda con control de revisión.
5. Aislar conocimiento, indexación, catálogo, prompts y cache. Aprovisionar sus
   tablas por schema además de las 33 tablas de negocio existentes.
6. Ensayar cutover por conexión y retirar rutas Evolution una vez conciliados
   mensajes, adjuntos, estados, reacciones y atribución; evitar doble consumidor.

Pruebas realizadas para este análisis: parseo de los tres JSON, recorrido estático
de conexiones y ejecución aislada del código normalizador con payloads sintéticos
sin red. Resultados:

| Caso sintético | Resultado observado |
|---|---|
| Mensaje sin contacts | Excepción al leer índice 0 |
| Contacto con nombre y sin username | Username `@null` |
| Dos mensajes de contactos distintos | Ambos reciben el username del primer contacto |

Estas pruebas reproducen defectos del export, no una prueba integral de la
instancia desplegada. Se documentaron las correcciones; no se modificaron ni
publicaron workflows en n8n.

Criterios de aceptación de la implementación: dos números/tenants en un lote,
mismo chat/wa_message_id en schemas distintos, perfiles ausentes, retries después
del ACK y después de INSERT, fallo de medios, análisis a demanda sin ingesta
duplicada, resultado IA atrasado, pausa preservada, nulls/citas correctos y
búsquedas/indexación RAG sin documentos del otro negocio.

