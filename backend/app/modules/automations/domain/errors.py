"""Errores de las automatizaciones.

Siguen siendo ``ValueError`` para el código del motor que los atrapa como
tales (p. ej. al parsear una fecha), pero el status lo decide el handler de
``DomainError``: la API ya no elige uno por ruta.
"""

from __future__ import annotations

import functools
import inspect

from app.core.errors import Conflict, DomainError
from app.modules.automations.domain.types import ExecutionErrorCode


class InvalidAutomation(DomainError, ValueError):
    """La regla o el flujo no son válidos."""

    status_code = 400
    code = "automation_invalid"


class StepFailed(InvalidAutomation):
    """Un paso de la ejecución no pudo completarse."""

    code = "automation_step_failed"

    def __init__(self, detail=None, *, execution_error: ExecutionErrorCode | None = None) -> None:
        super().__init__(detail)
        # Lo que la ejecución guarda en error_code (None = un fallo común).
        self.execution_error = execution_error


class AutomationConflict(Conflict, ValueError):
    """La operación choca con una ejecución en curso o con la pausa del lead."""

    code = "automation_conflict"


MALFORMED_INPUT = "La configuración enviada tiene un formato inválido"


def rejects_malformed_input(func):
    """Frontera de parseo: un ``ValueError`` (con su mensaje) o un
    ``TypeError`` del intérprete (una lista donde iba un objeto) es una
    entrada inválida, no un error del servidor. El texto de un ``TypeError``
    describe el código, no la regla: no se le muestra al usuario."""

    if inspect.iscoroutinefunction(func):
        @functools.wraps(func)
        async def wrapper_async(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except DomainError:
                raise
            except ValueError as exc:
                raise InvalidAutomation(str(exc)) from exc
            except TypeError as exc:
                raise InvalidAutomation(MALFORMED_INPUT) from exc

        return wrapper_async

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except DomainError:
            raise
        except ValueError as exc:
            raise InvalidAutomation(str(exc)) from exc
        except TypeError as exc:
            raise InvalidAutomation(MALFORMED_INPUT) from exc

    return wrapper
