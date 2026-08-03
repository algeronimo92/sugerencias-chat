# Identidad WhatsApp LID en n8n

La exportación local `rag.json` puede incluir los nodos y sustituciones de esta
guía, pero no se versiona porque contiene credenciales y tokens del workflow.
Las instrucciones siguientes sirven para revisarla después de importarla o
reproducir el cambio en otra instancia de n8n.

El backend resuelve `@lid` y `@s.whatsapp.net` como alias del mismo lead. El
workflow **rag** debe pedir esa resolución antes de insertar en `leads` o
`wsp_messages`; usar directamente `body.data.key.remoteJid` vuelve a crear el
problema de duplicados.

## Orden del workflow

```text
Webhook Evolution
  -> filtros existentes (messages.upsert, fromMe=false, chat individual)
  -> Resolver identidad WhatsApp (HTTP Request)
  -> nodos de contenido/análisis existentes
  -> guardar mensaje usando identity.chat_id
  -> webhooks del backend existentes
```

## Nodo `Resolver identidad WhatsApp`

- Método: `POST`
- URL interna: `http://backend:8000/api/webhooks/resolve-whatsapp-identity`
  (usar la URL real del backend si n8n no comparte la red Docker).
- `Content-Type`: `application/json`
- Body JSON: el body original de Evolution, `{{ $json.body }}`. También se
  acepta el item completo, `{{ $json }}`.
- Guardar la respuesta bajo un campo `identity` o combinarla con el item
  original mediante un nodo Merge por posición.

Respuesta típica con ambos alias:

```json
{
  "status": "ok",
  "chat_id": "51943663225@s.whatsapp.net",
  "send_jid": "51943663225@s.whatsapp.net",
  "phone": "+51943663225",
  "phone_jid": "51943663225@s.whatsapp.net",
  "lid_jid": "267692862898397@lid",
  "aliases": [
    "267692862898397@lid",
    "51943663225@s.whatsapp.net"
  ],
  "unresolved": false,
  "lead_created": true
}
```

Si Evolution todavía no permite conocer el teléfono, `chat_id` y `send_jid`
serán el LID, `phone` será `null` y `unresolved` será `true`. Nunca fabricar un
teléfono con los dígitos del LID.

## Sustituciones obligatorias

En todos los nodos SQL y llamadas al backend:

```text
ANTES: body.data.key.remoteJid
AHORA: identity.chat_id
```

En particular:

- `leads.remote_jid` / búsquedas de lead: `identity.chat_id`.
- `wsp_messages.chat_id`: `identity.chat_id`.
- Webhooks `/messages`, `/outgoing`, `/analysis`, `/reaction` y `/lead-stage`:
  mandar `identity.chat_id` cuando soliciten `chat_id`.
- `leads.telefono`: `identity.phone`; puede ser NULL.

El endpoint ya crea el lead mínimo de manera transaccional. El nodo que hoy
inserta/actualiza `leads` debe convertirse en `UPDATE`, o conservar un upsert
que no reemplace datos existentes con NULL:

```sql
UPDATE leads
SET nombre = COALESCE(NULLIF($2, ''), nombre),
    telefono = COALESCE($3, telefono),
    updated_at = now()
WHERE remote_jid = $1;
```

Parámetros: `$1 = identity.chat_id`, `$2 = body.data.pushName`,
`$3 = identity.phone`.

## Errores que deben detener la rama

- `422`: no es un chat individual o el payload no contiene un JID válido.
- `409`: los alias ya pertenecen a dos leads distintos. No continuar con el
  INSERT; enviar el caso a una rama de alerta/revisión para no mezclar
  historiales silenciosamente.

La deduplicación de mensajes sigue usando `key.id` en
`wsp_messages.wa_message_id`; es independiente de la deduplicación del lead.

## Despliegue

1. Desplegar backend y ejecutar `python -m scripts.migrate`.
2. Añadir el nodo resolvedor a n8n y reemplazar todos los usos del remoteJid
   crudo por `identity.chat_id`.
3. Probar un número tradicional, un LID con `remoteJidAlt` y un LID sin
   `remoteJidAlt`.
4. Confirmar que `whatsapp_identities` contiene ambos JID con el mismo
   `lead_id` y que los mensajes nuevos comparten un solo `chat_id`.
