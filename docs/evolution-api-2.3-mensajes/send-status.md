# sendStatus — historia/estado (Status de WhatsApp)

`POST /message/sendStatus/{instance}` (acepta JSON o multipart con campo `file`)

No lleva `number`: los destinatarios se controlan con `statusJidList`/`allContacts`.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | string | ✅ | `text` \| `image` \| `audio` \| `video`. |
| `content` | string | ✅* | Texto (si `type: text`) o URL/base64 del medio. *Omitible si se sube multipart `file`. |
| `caption` | string | — | Pie para imagen/video. |
| `backgroundColor` | string | — | Color de fondo en hex (`#008000`) para estados de texto. |
| `font` | integer | — | Tipografía del texto: 0–5 (serif, sans, cursiva, etc.). |
| `statusJidList` | string[] | condicional | Números que verán el estado. |
| `allContacts` | boolean | condicional | `true` publica para todos los contactos de la instancia. |

Hay que mandar `statusJidList` **o** `allContacts: true`; sin destinatarios el envío falla.

## Ejemplo (texto)

```json
{
  "type": "text",
  "content": "Promo de julio: 20% en faciales 🎉",
  "backgroundColor": "#075E54",
  "font": 2,
  "allContacts": true
}
```

## Ejemplo (imagen para algunos contactos)

```json
{
  "type": "image",
  "content": "https://ejemplo.com/promo.jpg",
  "caption": "Solo esta semana",
  "statusJidList": ["5215512345678", "5215598765432"]
}
```

## Notas

- El propio router lleva un `TODO: Revisar funcionamento do envio de Status` — es de los endpoints menos estables; validar en producción antes de automatizar.
- Con `allContacts: true` Evolution resuelve la lista de contactos guardados de la instancia, lo que puede ser lento en cuentas grandes.
- No usado por la app actualmente.
