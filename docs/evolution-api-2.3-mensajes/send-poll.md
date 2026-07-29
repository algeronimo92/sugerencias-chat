# sendPoll — encuesta

`POST /message/sendPoll/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Destino. |
| `name` | string | ✅ | Pregunta de la encuesta. |
| `selectableCount` | integer | ✅ | Cuántas opciones puede marcar el votante (0–10). `1` = opción única. |
| `values` | string[] | ✅ | Opciones: entre 2 y 10, únicas. |
| `delay`, `quoted`, `mentionsEveryOne`, `mentioned` | — | — | Ver [opciones-comunes.md](opciones-comunes.md). |

## Ejemplo

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "name": "¿Qué horario prefieres para tu cita?",
  "selectableCount": 1,
  "values": ["Mañana (9-12)", "Tarde (12-17)", "Noche (17-20)"]
}
```

## Notas

- Los votos llegan como eventos de webhook (`messages.update` con `pollUpdates`); en 2.3.x se mejoró el descifrado de votos de encuesta.
- Funciona en chats individuales y grupos, vía Baileys.
- No usado por la app actualmente; alternativa más nativa que `sendList` para captar preferencias de leads.
