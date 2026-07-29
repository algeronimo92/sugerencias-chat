# sendTemplate — plantilla oficial de WhatsApp Business

`POST /message/sendTemplate/{instance}`

**Solo funciona en instancias conectadas por la Cloud API oficial de Meta** (`integration: WHATSAPP-BUSINESS`). En instancias Baileys (QR) el adaptador no implementa plantillas — es la comprobación que hace `get_template_capabilities` en la app.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `name` | string | ✅ | Nombre de la plantilla aprobada en Meta. |
| `language` | string | ✅ | Código de idioma de la plantilla (`es_MX`, `en_US`…). |
| `components` | array | — | Parámetros de la plantilla, con el formato de componentes de la Cloud API de Meta. |
| `webhookUrl` | string | — | Webhook alternativo para los eventos de este envío. |

## Ejemplo

```json
{
  "number": "5215512345678",
  "name": "recordatorio_cita",
  "language": "es_MX",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Ana" },
        { "type": "text", "text": "martes 10:00" }
      ]
    }
  ]
}
```

## Notas

- `components` pasa tal cual a la Graph API de Meta; la referencia de formato es la de [message templates de la Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates).
- 2.3.7 añadió endpoints para **editar y borrar** plantillas Meta desde Evolution (gestión de ciclo de vida completa).
- 2.3.x corrigió el manejo de base64, `fileName` y `caption` al mandar media por la Cloud API.
- En la app: `send_whatsapp_template`, protegido por `get_template_capabilities`.
