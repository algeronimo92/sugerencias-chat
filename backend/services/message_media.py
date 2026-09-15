def mediatype_from_content_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    return "document"


def media_message_fields(
    mediatype: str, filename: str | None, album_id: str | None = None,
) -> tuple[str, dict | None]:
    """Deriva (message_type, payload) para un adjunto saliente.

    El mediatype (image/video/audio/document) ya es un message_type válido; solo
    document necesita conservar el nombre en payload, porque WhatsApp no le da
    caption y ese nombre es lo único que lo identifica del lado del receptor.
    Fuente única de este mapeo para los dos caminos de envío (el encolado del
    outbox y el envío síncrono de las automatizaciones).

    `album_id` viaja cuando el CRM mandó varias fotos/videos juntos desde un
    mismo picker (ver ChatComposer): WhatsApp no tiene forma de agrupar eso del
    lado del cliente, pero acá sí se puede agrupar en grilla de forma exacta en
    vez de adivinar por tiempo — ver utils/mediaGroups.ts en el frontend."""
    payload: dict = {}
    if mediatype == "document" and filename:
        payload["filename"] = filename
    if album_id:
        payload["album_id"] = album_id
    return mediatype, payload or None
