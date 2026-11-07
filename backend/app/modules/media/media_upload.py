import base64
import mimetypes
import uuid
from pathlib import Path

from app.integrations.storage.media_storage import (
    WHATSAPP_VIDEO_MAX_BYTES,
    VideoCompressionError,
    compress_video,
    save_media_bytes,
    video_is_whatsapp_compatible,
)

ALLOWED_CONTENT_PREFIXES = ("image/", "video/", "audio/")
# Documentos: se enumeran explícito en vez de aceptar cualquier content_type,
# para no convertir esto en un upload de archivos arbitrario (ej. .html/.svg
# servidos luego desde /media/ podrían ser un vector de XSS).
ALLOWED_DOCUMENT_TYPES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "application/zip",
)
MAX_BYTES = 25 * 1024 * 1024  # 25 MB
# Video: el límite es el de Meta (16 MB). Guardar uno más grande sólo
# posponía el error al worker de envío, cuando el usuario ya no está mirando.
MAX_VIDEO_BYTES = WHATSAPP_VIDEO_MAX_BYTES
# Cuánto puede pesar el video que llega para recomprimir. Viene en base64
# dentro del JSON y se decodifica entero en memoria, así que hace falta un
# techo; 100 MB son varios minutos de video de celular, y uno más largo no
# entra en 16 MB con una calidad que valga la pena.
MAX_VIDEO_SOURCE_BYTES = 100 * 1024 * 1024
# Contenedores de video que acepta Meta Cloud API. El resto (.mov, .webm) se
# convierte a MP4 aunque sus códecs sirvan.
WHATSAPP_VIDEO_CONTAINERS = {"video/mp4", "video/3gpp"}
SAFE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov",
    ".mp3", ".wav", ".ogg", ".m4a", ".weba", ".pdf", ".doc", ".docx", ".xls",
    ".xlsx", ".ppt", ".pptx", ".txt", ".zip",
}
EXTENSION_CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
    ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".weba": "audio/webm",
    ".pdf": "application/pdf", ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain", ".zip": "application/zip",
}

# ``mimetypes`` depende de la base de tipos de la imagen del sistema. Alpine
# no siempre conoce audio/webm, lo que antes dejaba las notas de voz sin
# extensión y hacía imposible inferir su categoría al leerlas después.
CONTENT_TYPE_EXTENSIONS = {
    "audio/webm": ".weba",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
}


def normalize_media_content_type(content_type: str, filename: str | None = None) -> str:
    normalized = content_type.split(";", 1)[0].strip().lower()
    if normalized.startswith(ALLOWED_CONTENT_PREFIXES) or normalized in ALLOWED_DOCUMENT_TYPES:
        return normalized
    if filename:
        suffix = Path(filename).suffix.lower()
        if suffix in EXTENSION_CONTENT_TYPES:
            return EXTENSION_CONTENT_TYPES[suffix]
    return normalized


def _video_needs_conversion(content_type: str, raw: bytes) -> bool:
    """WhatsApp solo manda video en MP4 (o 3GPP) con H.264 y AAC."""
    if content_type not in WHATSAPP_VIDEO_CONTAINERS:
        return True
    # None = no se pudo inspeccionar: no se convierte a ciegas.
    return video_is_whatsapp_compatible(raw) is False


def _prepare_video(content_type: str, raw: bytes, filename: str | None) -> tuple[bytes, str, str | None]:
    """Deja el video como WhatsApp lo reproduce: MP4 H.264/AAC de hasta 16 MB.

    El que ya cumple se guarda tal cual, sin perder calidad. El que pesa más
    o que WhatsApp no reproduce (VP9 o HEVC aunque la extensión sea .mp4,
    .mov, .webm) se recomprime con ffmpeg a la mejor calidad que entra en el
    límite. Si ffmpeg no está o falla, sigue el archivo original: el check de
    tamaño rechaza el que no entra, y el de códec incompatible sale igual —
    mejor eso que bloquear la subida.

    Los mensajes llevan "grande" porque los endpoints lo usan para responder
    413 en vez de 400."""
    if len(raw) > MAX_VIDEO_SOURCE_BYTES:
        raise ValueError(
            "El video es demasiado grande para convertirlo: máximo 100 MB antes de comprimir"
        )
    if len(raw) > MAX_VIDEO_BYTES or _video_needs_conversion(content_type, raw):
        try:
            raw = compress_video(raw, MAX_VIDEO_BYTES)
            content_type = "video/mp4"
            filename = None  # fuerza la extensión .mp4 del resultado
        except VideoCompressionError:
            pass
    if len(raw) > MAX_VIDEO_BYTES:
        raise ValueError("Archivo demasiado grande: WhatsApp acepta videos de hasta 16 MB")
    return raw, content_type, filename


def save_media_file(content_type: str, data_base64: str, filename: str | None = None) -> str:
    """Decodifica y guarda un archivo base64, y devuelve su media_url estable.
    Lanza ValueError con el motivo si el archivo no es válido."""
    try:
        raw = base64.b64decode(data_base64, validate=True)
    except Exception:
        raise ValueError("base64 inválido")
    return save_decoded_media(content_type, raw, filename)


def save_decoded_media(content_type: str, raw: bytes, filename: str | None = None) -> str:
    """Igual que ``save_media_file`` pero partiendo de los bytes ya decodificados.

    Quien ya tiene el archivo en memoria (por ejemplo la nota de voz que se
    transcodifica antes de guardar) no debería volver a codificarlo en base64
    solo para que acá se decodifique otra vez.

    La extensión se toma del filename original cuando está disponible, en vez
    de adivinarla con mimetypes.guess_extension(content_type): en la imagen
    Linux del backend, ese mapeo no conoce los tipos Office Open XML (.docx,
    .xlsx, .pptx) y devuelve None — el archivo terminaba guardado sin
    extensión, y como esos formatos son en el fondo un ZIP, el navegador lo
    servía/interpretaba como tal en vez de como el documento real."""
    content_type = normalize_media_content_type(content_type, filename)
    if not (content_type.startswith(ALLOWED_CONTENT_PREFIXES) or content_type in ALLOWED_DOCUMENT_TYPES):
        raise ValueError("Tipo de archivo no permitido")

    if not raw:
        raise ValueError("El archivo está vacío")

    if content_type.startswith("video/"):
        raw, content_type, filename = _prepare_video(content_type, raw, filename)
    elif len(raw) > MAX_BYTES:
        raise ValueError("Archivo demasiado grande")

    ext = ""
    if filename and "." in filename:
        candidate = "." + filename.rsplit(".", 1)[-1].lower()
        if candidate in SAFE_EXTENSIONS:
            ext = candidate
    if not ext:
        ext = CONTENT_TYPE_EXTENSIONS.get(content_type) or mimetypes.guess_extension(content_type) or ""

    stored_filename = f"{uuid.uuid4().hex}{ext}"
    return save_media_bytes(stored_filename, raw, content_type)
