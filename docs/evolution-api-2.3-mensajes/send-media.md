# sendMedia — imagen, video, documento o audio adjunto

`POST /message/sendMedia/{instance}` (acepta JSON o multipart con campo `file`)

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `mediatype` | string | ✅ | `image` \| `video` \| `document` \| `audio`. |
| `media` | string | ✅* | URL pública o base64 del archivo. *Omitible solo si se sube el binario como multipart `file`. |
| `mimetype` | string | — | MIME del archivo; si falta, Evolution lo infiere. |
| `caption` | string | — | Pie del mensaje (imagen/video/documento). |
| `fileName` | string | — | Nombre visible del archivo; relevante sobre todo para `document`. |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Ejemplo (imagen por URL)

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "mediatype": "image",
  "media": "https://ejemplo.com/foto.jpg",
  "caption": "Resultado del tratamiento"
}
```

## Ejemplo (documento en base64)

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "mediatype": "document",
  "mimetype": "application/pdf",
  "fileName": "presupuesto.pdf",
  "media": "JVBERi0xLjQK..."
}
```

## Notas

- El DTO declara `ptv` como quinto `mediatype`, pero la validación del endpoint solo admite los cuatro de arriba; para video-nota circular está [sendPtv](send-ptv.md).
- `mediatype: "audio"` manda el audio como archivo reproducible normal; para nota de voz (PTT, con onda y micrófono) está [sendWhatsAppAudio](send-whatsapp-audio.md).
- En la app: `send_whatsapp_media`, que manda base64 y `fileName` opcional.
