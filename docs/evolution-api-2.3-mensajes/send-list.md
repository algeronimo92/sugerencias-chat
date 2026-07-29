# sendList — mensaje de lista (menú desplegable)

`POST /message/sendList/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `title` | string | ✅ | Título del mensaje. |
| `description` | string | — | Texto bajo el título. |
| `footerText` | string | ✅ | Pie del mensaje. |
| `buttonText` | string | ✅ | Texto del botón que abre la lista. |
| `sections` | object[] | ✅ | Secciones del menú (mínimo 1). |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

Cada sección:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `title` | string | ✅ | Encabezado de la sección. |
| `rows` | object[] | ✅ | Filas (mínimo 1). |
| `rows[].title` | string | ✅ | Texto principal de la fila. |
| `rows[].description` | string | — | Texto secundario. |
| `rows[].rowId` | string | ✅ | Id que llega en el webhook cuando el usuario elige la fila. |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "title": "Nuestros tratamientos",
  "description": "Elige uno para más información",
  "buttonText": "Ver opciones",
  "footerText": "DermicaPro",
  "sections": [
    {
      "title": "Faciales",
      "rows": [
        { "title": "Limpieza profunda", "description": "60 min", "rowId": "trat_limpieza" },
        { "title": "Peeling", "description": "45 min", "rowId": "trat_peeling" }
      ]
    }
  ]
}
```

## Notas

- Ojo: `footerText` es **requerido** por la validación aunque parezca decorativo (la app manda `"DermicaPro"` por defecto).
- La respuesta del usuario llega como `listResponseMessage` en el webhook, con el `rowId` elegido.
- El render de listas vía Baileys es inestable en algunas versiones de WhatsApp (limitación del protocolo, no de Evolution); probar en dispositivos reales antes de apostar un flujo a esto.
- En la app: `send_whatsapp_list`.
