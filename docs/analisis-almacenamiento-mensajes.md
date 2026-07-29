# Análisis: almacenamiento de mensajes, el bloque `Analisis:` y ¿migrar a Mongo?

Fecha: 2026-07-28. Datos tomados de la base de producción y del código actual.

## Cómo se guarda un mensaje hoy

`wsp_messages.content` es un solo campo `Text` que multiplexa tres cosas con un formato informal que inventó el workflow de n8n:

```
<image>
¡Descubre el poder del *HIFU 12D*! ✨ ...   ← caption real del mensaje

Analisis: La imagen es un anuncio publicitario de un tratamiento
estético facial llamado HIFU 12D...          ← análisis generado con IA
</image>
```

Ejemplo real (mensaje 1171, cliente): un comprobante de pago Yape llega como
`<image>\n\nAnalisis: La imagen muestra un comprobante de pago de Yape... monto de S/ 30...</image>`.

Números actuales:

| Métrica | Valor |
|---|---|
| Mensajes totales | 1 128 |
| Con adjunto (`media_url`) | 294 |
| Con bloque `Analisis:` | 266 (43 de cliente, 223 de vendedor) |
| Longitud media / máxima de `content` | 252 / 2 385 caracteres |
| Tamaño total de la tabla (con índices) | ~2 MB |
| Marcadores | `<text>` 804 · `<video>` 145 · `<image>` 119 · `<audio>` 30 · `<location>` 1 · `<other>` 1 · sin marcador 3 |

Quién toca ese formato:

- **n8n** lo escribe (inserta directo en PostgreSQL y luego pinguea `/webhooks/messages`).
- **El backend** lo pasa tal cual (`insert_message`, `fetch_messages` no saben del formato).
- **El frontend** lo parsea con regex en `parseContent` (`frontend/src/utils/message.ts`): `^<(\w+)>([\s\S]*)<\/\1>$`.

## Problemas identificados

1. **El análisis IA se muestra al usuario.** `parseContent` devuelve el interior del tag completo, y `ChatThread` lo renderiza como epígrafe en cursiva bajo la imagen/video/audio (`ChatThread.tsx` ~línea 1123). El vendedor ve párrafos de análisis técnico dentro de la burbuja. Lo mismo pasa en el preview del listado de chats (`ChatItem`), en las citas (`quotePreview`) y en el `alt` de la galería.
2. **Sin estructura.** Tipo de mensaje, caption y enriquecimiento IA viven concatenados en texto plano. No se puede consultar "mensajes de tipo imagen" ni "mensajes sin análisis" sin `LIKE`; no hay dónde guardar metadatos del análisis (modelo usado, fecha, versión, transcripción vs descripción) sin romper el formato.
3. **Formato frágil y triplicado.** El contrato `<tag>…</tag>` + `Analisis:` vive implícito en n8n (escritura), frontend (parseo) y ahora en cualquier consumidor nuevo. Un caption que contenga `</image>` o un tag sin cerrar caen al caso "texto plano" y muestran los tags literales.
4. **La búsqueda matchea sobre el análisis.** `_message_match_condition` hace ILIKE sobre `content` completo. Es un arma de doble filo: buscar "yape" encuentra el comprobante (útil), pero también matchea palabras que el cliente nunca escribió, y el snippet resaltado puede ser un pedazo del texto de la IA.
5. **Payload inflado.** Cada página de mensajes y cada `last_message` viaja al navegador con el análisis completo (hasta ~2.4 KB por mensaje) aunque no se debería mostrar.
6. **No hay reprocesamiento.** Si mañana se mejora el prompt o el modelo, no hay forma limpia de regenerar análisis: habría que reescribir `content` a mano cuidando de no pisar el caption.

## ¿Migrar a MongoDB? No — y por qué

El problema es de **modelado**, no de motor. Mongo no arregla nada de la lista anterior (un documento con el análisis embebido en un string sigue igual de mal) y sí cuesta:

- **Escala actual irrelevante**: 2 MB y 1 128 filas. PostgreSQL maneja cientos de millones de mensajes con los índices que ya existen (`(chat_id, sent_at DESC, id DESC)` para paginado, GIN trigram para búsqueda insensible a acentos).
- **Se perdería integridad referencial real en uso**: FK a `leads` con `ON DELETE CASCADE`, y `message_outbox` y `scheduled_messages` referencian `wsp_messages.id`. En Mongo eso pasa a ser responsabilidad de la aplicación.
- **Reescritura masiva sin beneficio**: toda la capa `db_service.py` (SQLAlchemy), Alembic, los workflows de n8n que hacen SQL directo contra la base, y los backups (`db/backups`) habría que rehacerlos o duplicarlos.
- **Lo "schemaless" ya lo da Postgres**: JSONB con índices GIN ofrece documentos flexibles sin renunciar a joins ni transacciones.
- **Operación**: un segundo motor que instalar, respaldar y asegurar (la base actual ya viaja sin TLS por Internet; sumar otra superficie de ataque va en contra).

Veredicto: **quedarse en PostgreSQL y normalizar el modelo**.

## Modelo objetivo

```sql
ALTER TABLE wsp_messages
  ADD COLUMN message_type text,      -- 'text'|'image'|'video'|'audio'|'location'|'document'|'other'
  ADD COLUMN analysis jsonb;         -- NULL si no hay enriquecimiento IA
```

- `content` pasa a contener **solo lo que escribió el humano** (caption o texto; NULL si el adjunto no lleva caption).
- `message_type` reemplaza al marcador `<tag>` (con CHECK constraint como el de `sender`).
- `analysis` guarda el enriquecimiento estructurado:

```json
{
  "summary": "La imagen muestra un comprobante de pago de Yape...",
  "kind": "descripcion",            // descripcion | transcripcion | ocr
  "model": "gemini-2.5-flash",
  "generated_at": "2026-07-28T16:40:00Z",
  "version": 1
}
```

Columna JSONB y no tabla aparte: hay a lo sumo un análisis vigente por mensaje y los lectores lo quieren junto al mensaje. Si algún día hace falta historial de versiones o varios análisis por mensaje, se extrae a `wsp_message_analysis` con FK — la migración desde la columna es trivial.

Búsqueda: mantener el hallazgo útil (encontrar media por su análisis) pero explícito — extender el índice trigram existente o indexar también `analysis->>'summary'`, y que el backend distinga en `matched_message` si el match fue en texto del cliente o en análisis IA.

UI: la burbuja muestra solo el caption; el análisis puede exponerse bajo demanda (ícono ✨ que despliega "Análisis IA", útil para audios largos) en vez de pegado al mensaje.

## Plan de migración (fases compatibles hacia atrás)

**Fase 1 — Esquema (sin cambio de comportamiento).**
Migración Alembic que agrega `message_type` y `analysis`, ambas NULL. Nada las lee todavía. Riesgo cero, deploy normal.

**Fase 2 — Doble escritura.**
- n8n: el workflow de entrada escribe `message_type` y `analysis` en columnas, y **deja de** incrustar `Analisis:` en `content` (el caption va limpio). Mientras conviven versiones, el frontend sigue entendiendo el formato viejo vía `parseContent`.
- Backend: `insert_message` acepta y escribe `message_type` en los envíos salientes (hoy el tipo se infiere del endpoint usado: texto, audio, media, ubicación).

**Fase 3 — Backfill.**
Script único (con dump previo de `db/backups` como respaldo) que recorre las filas viejas y separa con la misma regex del frontend:
- tag → `message_type`
- interior antes de `Analisis:` → `content` limpio
- bloque `Analisis:` → `analysis.summary` con `version: 0` (marca "migrado, modelo desconocido")
- las 3 filas sin marcador y los tags no cerrados quedan como `message_type='text'` sin tocar `content`.
Verificación: contar que `content LIKE '%Analisis:%'` quede en 0 y spot-check de 10 mensajes en la UI.

**Fase 4 — Lectura nueva.**
- `Message` (Pydantic) y `fetch_messages` exponen `message_type` y `analysis`; el listado de chats y la búsqueda dejan de mandar el análisis completo (solo el snippet cuando hay match).
- Frontend: `parseContent` queda como fallback para contenido legado ya limpio (debería no activarse tras el backfill) y los componentes usan `message_type`/caption. Se agrega el desplegable de análisis.

**Fase 5 — Limpieza.**
Borrar el fallback de parseo, CHECK constraint en `message_type`, y decidir el índice de búsqueda sobre `analysis` según uso real.

Rollback: las fases 1–3 son aditivas (las columnas nuevas se pueden ignorar); el formato viejo solo desaparece de `content` en el backfill, con dump previo.

## Escalabilidad más allá de esto

Con el modelo normalizado, los siguientes cuellos reales (a millones de mensajes, no antes) serían: particionar `wsp_messages` por mes, réplica de lectura para dashboard/búsqueda, y pasar la búsqueda de trigram a FTS (`tsvector` en español). Los archivos multimedia ya están fuera de la base (disco/MinIO vía `media_url`) — eso está bien resuelto. Pendiente de seguridad ya conocido: habilitar TLS en el servidor Postgres (`database_ssl` está en `prefer` esperándolo).
