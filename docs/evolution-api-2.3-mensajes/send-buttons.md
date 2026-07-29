# sendButtons — botones interactivos

`POST /message/sendButtons/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `title` | string | ✅ (DTO) | Título del mensaje. |
| `description` | string | — | Cuerpo del mensaje. |
| `footer` | string | — | Pie. |
| `thumbnailUrl` | string | — | Imagen de cabecera. |
| `buttons` | object[] | ✅ en la práctica | Botones (WhatsApp muestra máx. 3 de tipo `reply` bien renderizados). |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Tipos de botón

Cada botón lleva `type` más los campos de su tipo:

| `type` | Campos | Efecto |
|---|---|---|
| `reply` | `displayText`, `id` | Al tocar, responde con el texto; `id` llega en el webhook. |
| `copy` | `displayText`, `copyCode` | Copia `copyCode` al portapapeles (códigos de descuento, etc.). |
| `url` | `displayText`, `url` | Abre el enlace. |
| `call` | `displayText`, `phoneNumber` | Inicia llamada al número. |
| `pix` | `currency`, `name`, `keyType` (`phone`\|`email`\|`cpf`\|`cnpj`\|`random`), `key` | Botón de pago Pix (solo Brasil). |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "title": "¿Confirmamos tu cita?",
  "description": "Mañana 10:00 en sucursal Centro",
  "footer": "DermicaPro",
  "buttons": [
    { "type": "reply", "displayText": "Confirmar", "id": "cita_confirmar" },
    { "type": "reply", "displayText": "Reagendar", "id": "cita_reagendar" },
    { "type": "url", "displayText": "Cómo llegar", "url": "https://maps.app.goo.gl/xyz" }
  ]
}
```

## Notas

- Se envían como mensaje interactivo de Baileys: el render depende de la versión del cliente WhatsApp del receptor y puede fallar (llegar vacío o solo el texto). Es la limitación clásica de botones fuera de la Cloud API oficial — probar siempre en dispositivos reales.
- La pulsación de un `reply` llega al webhook como `templateButtonReplyMessage`/`buttonsResponseMessage` con el `id`.
- Soporte del botón `pix` mejorado en 2.3.7.
- En la app: `send_whatsapp_buttons`.
