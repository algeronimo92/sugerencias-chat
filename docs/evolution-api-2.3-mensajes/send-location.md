# sendLocation — ubicación

`POST /message/sendLocation/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `latitude` | number | ✅ | Latitud decimal. |
| `longitude` | number | ✅ | Longitud decimal. |
| `name` | string | ✅ | Nombre del lugar (título del pin). |
| `address` | string | ✅ | Dirección (subtítulo del pin). |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "latitude": 19.432608,
  "longitude": -99.133209,
  "name": "DermicaPro",
  "address": "Av. Ejemplo 123, CDMX"
}
```

## Notas

- **Trampa conocida**: el DTO y la documentación web marcan `name` y `address` como opcionales, pero el JSON Schema del servidor los exige — omitirlos da `400 instance requires property name/address`. La app ya lo resuelve mandando `""` cuando no hay valor (`send_whatsapp_location`).
- El pin funciona como enlace a Google Maps en el cliente; no hace falta duplicar lat/lon en el texto.
