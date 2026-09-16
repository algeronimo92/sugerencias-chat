# Sacar a n8n de la base de datos

n8n todavía escribe y lee `leads` y `wsp_messages` con nodos Postgres. Eso
acopla el esquema al workflow: un rename o un `NOT NULL` rompe n8n en
silencio, los cambios del agente no quedan auditados y `alembic/env.py` tiene
que excluir esas dos tablas de `autogenerate` (`EXTERNAL_TABLES`).

La app ya expone un endpoint para **cada** nodo Postgres del workflow. Falta
cambiar los nodos en n8n y quitarle los permisos de escritura.

## Equivalencias

Todos los endpoints van bajo `/api/webhooks/` y piden la cabecera
`X-Webhook-Token` (ver `INBOUND_WEBHOOK_TOKEN`).

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

## Qué se gana

- El cambio del agente queda auditado en `lead_activity` y avisa por WebSocket
  a los paneles abiertos (el UPDATE directo no hacía ninguna de las dos).
- El alta de leads pasa por `ensure_lead_stub`, que es idempotente.
- El esquema deja de ser parte del contrato con n8n.

## Pasos

1. En n8n, reemplazar cada nodo Postgres por un nodo HTTP Request según la
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

`backend/tests/test_n8n_contract.py` falla si aparece un nodo Postgres nuevo
en los workflows de `docs/`, para que la deuda no crezca mientras tanto.
