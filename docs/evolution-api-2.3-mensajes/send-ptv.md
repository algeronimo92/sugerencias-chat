# sendPtv — video-nota circular

`POST /message/sendPtv/{instance}` (acepta JSON o multipart con campo `file`)

PTV = "picture-to-video", el video redondo que se graba con la cámara frontal.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `video` | string | ✅* | URL pública o base64 del video. *Omitible si se sube como multipart `file`. |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "video": "https://ejemplo.com/saludo.mp4"
}
```

## Notas

- No admite `caption`: las video-notas de WhatsApp no llevan texto.
- WhatsApp lo muestra recortado en círculo; conviene video cuadrado y corto (≤ 60 s) para que se vea bien.
- No usado por la app actualmente; candidato natural para saludos personalizados de campañas.
