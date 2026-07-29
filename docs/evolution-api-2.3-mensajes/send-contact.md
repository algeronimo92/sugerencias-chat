# sendContact — tarjeta(s) de contacto

`POST /message/sendContact/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `contact` | object[] | ✅ | Una o más tarjetas (mínimo 1). |

Cada elemento de `contact`:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `fullName` | string | ✅ | Nombre mostrado. |
| `phoneNumber` | string | ✅ | Teléfono visible (mínimo 10 caracteres, admite formato `+52 1 55...`). |
| `wuid` | string | — | Número de WhatsApp del contacto, solo dígitos (mínimo 10). Permite que el receptor abra chat directo. |
| `organization` | string | — | Empresa. |
| `email` | string | — | Correo. |
| `url` | string | — | Sitio web. |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "contact": [
    {
      "fullName": "Recepción DermicaPro",
      "wuid": "5215598765432",
      "phoneNumber": "+52 1 55 9876 5432",
      "organization": "DermicaPro",
      "email": "contacto@dermicapro.mx",
      "url": "https://dermicapro.mx"
    }
  ]
}
```

## Notas

- Evolution genera el vCard internamente a partir de estos campos.
- Con varios elementos en `contact` WhatsApp lo muestra como lista de contactos en un solo mensaje.
- No usado por la app actualmente.
