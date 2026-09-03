# sendWhatsAppAudio — nota de voz (PTT)

`POST /message/sendWhatsAppAudio/{instance}` (acepta JSON o multipart con campo `file`)

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `audio` | string | ✅* | URL pública o base64 del audio. *Omitible si se sube como multipart `file`. |
| `encoding` | boolean | — | Si Evolution debe reconvertir el audio a opus/ogg (formato nativo de nota de voz). Por defecto convierte. |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). `delay` muestra "grabando audio…". |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "audio": "T2dnUwACAAAA...",
  "delay": 1500
}
```

## Notas

- Siempre llega como **nota de voz** (burbuja con onda y botón de reproducir), no como archivo adjunto. Para audio como adjunto usar [sendMedia](send-media.md) con `mediatype: "audio"`.
- La conversión a opus requiere ffmpeg en el servidor de Evolution; si el audio ya es ogg/opus se puede desactivar con `encoding: false`.
- **Roto en la instancia Meta Cloud API (WHATSAPP-BUSINESS) de esta app**: acepta el envío (201, `wamid` real) pero el mensaje nunca progresa ni un solo estado — ni siquiera en el historial propio de Evolution (`chat/findMessages` devuelve `MessageUpdate: []` para siempre) — y no genera ningún webhook de error. Confirmado mandando el mismo archivo Ogg/Opus por acá (nunca entregado) y por [sendMedia](send-media.md) con `mediatype: "audio"` (entregado y leído en segundos). La app ya no usa este endpoint para audio saliente por ese motivo — ver `send_whatsapp_media` en `evolution_service.py`.
