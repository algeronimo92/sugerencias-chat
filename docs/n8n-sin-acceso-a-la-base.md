# Sacar a n8n de la base de datos

Revisión: 2026-09-17. En los exports locales actuales, `rag.json` y el webhook
Meta usan HTTP para los datos del CRM; **`analista.json` conserva cinco nodos
Postgres**. Los exports están ignorados por Git y no confirman el despliegue.
Ver el [análisis actualizado](analisis/10-workflows-n8n-meta-multitenant.md) y el
[plan por schemas](multi-tenant-saas-plan.md#7-webhooks-n8n-y-whatsapp).

El analista todavía escribe y lee `leads` y `wsp_messages` con nodos Postgres. Eso
acopla el esquema al workflow: un rename o un `NOT NULL` rompe n8n en
silencio, los cambios del agente no quedan auditados y `alembic/env.py` tiene
que excluir esas dos tablas de `autogenerate` (`EXTERNAL_TABLES`).

La app expone endpoints de reemplazo, pero **no tienen paridad completa con el
analista exportado**. Primero completar los contratos descritos abajo, después
cambiar nodos y retirar permisos. El acceso de RAG a Supabase `documents` es otra
dependencia de datos y también debe aislarse por negocio.

## Equivalencias

Todos los endpoints van bajo `/api/webhooks/` y piden la cabecera
`X-Webhook-Token` (ver `INBOUND_WEBHOOK_TOKEN`).

Este es el contrato actual single-tenant. El token compartido y `chat_id` solos
no autorizan acceso a schemas distintos: la migración debe añadir contexto
autorizado de evento/conexión o job según el plan. Los nombres de nodos de la
tabla incluyen equivalencias históricas, no todos son SQL en el export actual.

| Nodo Postgres | Qué hacía | Endpoint |
|---|---|---|
| `create lead` | INSERT en `leads` | `POST /ensure-lead` |
| `guardar mensajes en posgress` | INSERT en `wsp_messages` | `POST /save-inbound-message` |
| `update lead` | UPDATE de los campos del agente analista | `POST /lead-analysis` |
| `update lead4` | UPDATE de `ultimo_emisor` / `ultimo_mensaje_at` | `POST /lead-inbound-activity` |
| `get lead`, `get lead4`, `try to get lead` | SELECT de la fila del lead | `GET /lead-raw?chat_id=` |
| `get messages1`, `get messages2` | SELECT de los mensajes del chat | `GET /lead-messages-raw?chat_id=&limit=` |
| `buscar mensaje existente1` | SELECT por `wa_message_id` | `GET /message-by-wa-id-raw?wa_message_id=` |
| `ultimo mensaje1` | SELECT del último `wa_message_id` | `GET /last-message-raw?chat_id=` |

La etapa del lead ya se movía por `POST /lead-stage`, que además dispara las
automatizaciones de cambio de etapa.

## Diferencias que deben resolverse antes de sustituir el analista

- `LeadAnalysisWebhookBody` no admite `proxima_cita` ni `con_especialista`,
  presentes en `update lead`. Completar el contrato y validar sus invariantes.
- `lead-analysis` usa `exclude_none=True`; los nulls explícitos no limpian campos.
  Definir patch por campo: ausente conserva y null explícito limpia solo si está
  permitido. Revisar los sentinelas del analista para no borrar por incertidumbre.
- Los dos UPDATE del analista fijan `conversacion_version = 0`; `update lead4`
  además fuerza `automatizacion_pausada = false`. No trasladar esas escrituras
  a HTTP: estos controles pertenecen al backend.
- `update lead4` usa `data[0].created_at`, pero `get messages1` selecciona
  `sent_at`. Mantener actividad del lead en la ingesta y corregir el timestamp;
  no depender del analista, que se invocará a demanda.
- Preservar orden/límite y enriquecimiento de historial con `analysis.summary`.
  La API del último mensaje omite filas sin `wa_message_id`; el SQL actual no.
  Definir el cursor que usará el nuevo contrato.
- Comprobar revisión de contexto al aplicar el resultado, no solo antes del
  modelo. Coordinar campos y etapa para evitar actualizaciones parciales y
  automatizaciones repetidas en retries.

## Qué se gana

- El cambio del agente queda auditado en `lead_activity` y avisa por WebSocket
  a los paneles abiertos (el UPDATE directo no hacía ninguna de las dos).
- El alta de leads pasa por `ensure_lead_stub`, que es idempotente.
- El esquema deja de ser parte del contrato con n8n.

## Pasos

1. Resolver las diferencias de contrato y autorización anteriores. En n8n,
   reemplazar cada nodo Postgres por un nodo HTTP Request según la
   tabla. Los endpoints `*-raw` devuelven `{}` cuando no hay fila, el mismo
   shape que devolvía el nodo con `alwaysOutputData`.
2. Verificar con un mensaje de prueba de punta a punta.
3. Quitarle a n8n el acceso de escritura:

```sql
REVOKE INSERT, UPDATE, DELETE ON leads, wsp_messages FROM n8n;
-- Cuando también se hayan migrado las lecturas:
REVOKE SELECT ON leads, wsp_messages FROM n8n;
```

4. Recién entonces, vaciar `EXTERNAL_TABLES` en `backend/alembic/env.py` y
   generar la migración que alinee el esquema con `models.py` (hoy quedan
   afuera columnas que solo usa n8n, como `leads.metadata`).

`backend/tests/test_n8n_contract.py` busca solo `docs/rag*.json` y permite un
conjunto de nombres de nodos Postgres heredados. No inspecciona los exports de
la raíz ni garantiza cero SQL; omite esa comprobación si no encuentra fixtures.
Añadir fixtures sanitizadas de los workflows activos, incluido analista, y
comprobaciones de los contratos nuevos antes de declarar completada la migración.
