# sendSticker — sticker

`POST /message/sendSticker/{instance}` (acepta JSON o multipart con campo `file`)

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `sticker` | string | ✅* | URL pública o base64 de la imagen. *Omitible si se sube como multipart `file`. |
| `notConvertSticker` | boolean | — | Si es `true`, no convierte la imagen a webp (asume que ya viene en formato sticker). |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "sticker": "https://ejemplo.com/logo.png"
}
```

## Notas

- Evolution convierte automáticamente png/jpg a webp 512×512 (requiere procesamiento de imagen en el servidor).
- Para stickers animados hay que mandar un webp animado ya preparado con `notConvertSticker: true`.
- No usado por la app actualmente.
