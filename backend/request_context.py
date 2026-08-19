"""ContextVar con el `request_id` de la request HTTP en curso.

Vive en su propio módulo (en vez de dentro de `main.py` o `logging_config.py`)
porque ambos lo necesitan: el middleware de `main.py` lo escribe al empezar
cada request, y `logging_config.RequestIdFilter` lo lee para estampar cada
línea de log. Un módulo aparte evita el import circular entre los dos.

Antes de esto no había forma de correlacionar los logs de una misma request
entre sí, ni de rastrear un flujo completo (webhook -> automatización ->
Evolution -> outbox) que atraviesa varias tareas async.
"""

from contextvars import ContextVar, Token

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    return _request_id.get()


def set_request_id(value: str) -> Token:
    """Fija el request_id y devuelve el token para revertirlo con `reset`.

    Simétrico al patrón `begin_request_metrics`/`finish_request_metrics` de
    `services/performance.py`: el middleware que lo llama es responsable de
    hacer `reset` al terminar la request, para que el contextvar no arrastre
    valores entre requests que compartan la misma tarea.
    """
    return _request_id.set(value)


def reset_request_id(token: Token) -> None:
    _request_id.reset(token)
