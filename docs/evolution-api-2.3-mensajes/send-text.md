# sendText — texto plano

`POST /message/sendText/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `text` | string | ✅ | Cuerpo del mensaje. Admite formato de WhatsApp (`*negrita*`, `_cursiva_`, `~tachado~`, ` ```mono``` `). |
| `linkPreview` | boolean | — | Vista previa si `text` contiene una URL. |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Ejemplo mínimo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "text": "Hola, ¿en qué te puedo ayudar?"
}
```

## Ejemplo completo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "text": "Mira esto: https://ejemplo.com",
  "linkPreview": true,
  "delay": 1200,
  "quoted": {
    "key": { "id": "BAE5F5A0C7D5E2B1" },
    "message": { "conversation": "¿Tienes el enlace?" }
  }
}
```

## Notas

- Es el único tipo donde `linkPreview` tiene efecto.
- En la app: `send_whatsapp_text` (`backend/services/evolution_service.py`), que ya soporta `quoted`.
