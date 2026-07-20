"""Ubicación en disco de los archivos subidos y lectura segura de los mismos.

Vive en services/ y no en routers/ para que la capa de servicios no tenga que
importar desde la capa HTTP: automation_service necesita leer adjuntos para
enviarlos por WhatsApp, y un servicio importando de un router invierte la
dirección de las dependencias.
"""

import base64
from pathlib import Path

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)


def read_media_base64(media_url: str) -> str:
    """Devuelve el contenido del archivo en base64 listo para Evolution API.

    media_url llega desde la base de datos (ej. "/media/abc123.pdf"). Solo se
    usa el último segmento y se verifica que el path resuelto siga dentro de
    MEDIA_DIR: sin eso, un media_url manipulado con ".." leería archivos
    arbitrarios del contenedor.
    """
    path = (MEDIA_DIR / media_url.rsplit("/", 1)[-1]).resolve()
    if path.parent != MEDIA_DIR.resolve() or not path.is_file():
        raise FileNotFoundError(media_url)
    return base64.b64encode(path.read_bytes()).decode("ascii")
