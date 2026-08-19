"""Configuración centralizada de logging.

Antes de este módulo no existía ni `logging.basicConfig` ni `dictConfig` en
ningún lado del backend: el formato de los logs quedaba librado a lo que
uvicorn decidiera por defecto (texto plano, sin `request_id`, sin
estructura). Todo termina en Loki vía Alloy, que solo lee stdout/stderr de
Docker con los labels `container`/`stream` (ver `monitoring/alloy/config.alloy`)
— sin JSON estructurado, cada consulta en Grafana necesita un regex costoso
sobre el texto crudo.

`configure_logging()` reemplaza la configuración de logging del proceso
completo (incluida la de uvicorn) por un único formatter JSON, y debe
llamarse una sola vez, lo antes posible al arrancar el proceso — antes de que
se emita cualquier log — para que ningún handler por defecto llegue a
registrarse con el formato viejo.
"""

import json
import logging
import logging.config
import os
from datetime import datetime, timezone

from request_context import get_request_id

LOG_RECORD_RESERVED_ATTRS = frozenset(
    logging.LogRecord(
        name="", level=0, pathname="", lineno=0, msg="", args=(), exc_info=None
    ).__dict__.keys()
) | {"message", "asctime"}


class RequestIdFilter(logging.Filter):
    """Agrega el `request_id` de la request HTTP en curso a cada registro.

    Lee el contextvar que llena el middleware de `main.py` (ver
    `request_context.py`). Fuera de una request (tareas de fondo, arranque),
    o si el contextvar no se propagó, cae a "-" en vez de fallar: un filtro
    de logging que lanza excepción se traga logs silenciosamente.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or "-"
        return True


class JsonFormatter(logging.Formatter):
    """Serializa cada registro como una línea JSON.

    No se agrega `python-json-logger` ni `structlog` como dependencia nueva:
    el formato que necesitamos (campos fijos + extras) es un `json.dumps`
    simple, y `requirements.txt` no traía ninguna lib de JSON logging.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        # Campos extra pasados vía `logger.info(..., extra={...})`: se
        # incluyen tal cual para no perder contexto que el llamador consideró
        # útil, sin duplicar los campos reservados del LogRecord.
        for key, value in record.__dict__.items():
            if key in LOG_RECORD_RESERVED_ATTRS or key == "request_id":
                continue
            try:
                json.dumps(value)
            except TypeError:
                value = str(value)
            payload[key] = value

        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Reemplaza la configuración de logging del proceso por JSON a stdout.

    Se apoya en `disable_existing_loggers=False` porque varios módulos hacen
    `logging.getLogger(__name__)` a nivel de import, antes de que el
    lifespan llegue a llamar esta función; desactivarlos los dejaría mudos.
    Los loggers de uvicorn se reconfiguran explícitamente para que el access
    log también salga en JSON en vez del formato de texto que trae uvicorn
    por defecto.
    """
    level = os.environ.get("LOG_LEVEL", "INFO").upper()

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "request_id": {"()": RequestIdFilter},
            },
            "formatters": {
                "json": {"()": JsonFormatter},
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "formatter": "json",
                    "filters": ["request_id"],
                    "stream": "ext://sys.stdout",
                },
            },
            "root": {
                "level": level,
                "handlers": ["stdout"],
            },
            "loggers": {
                "uvicorn": {"level": level, "handlers": ["stdout"], "propagate": False},
                "uvicorn.error": {"level": level, "handlers": ["stdout"], "propagate": False},
                # uvicorn.access ya trae su propio mensaje formateado (método,
                # ruta, status); acá solo cambia el transporte a JSON, no el
                # contenido del campo "message".
                "uvicorn.access": {"level": level, "handlers": ["stdout"], "propagate": False},
            },
        }
    )
