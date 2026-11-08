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
    """La regla o el flujo no son válidos.

    ``node_id`` es el bloque del flujo al que se refiere el error, cuando se
    refiere a uno: la respuesta lo manda como ``target`` y el editor lo
    muestra como "Bloque #12" con un botón para ir a él. Antes el mensaje
    decía "Bloque 7", "Acción 3" o "Espera 2" (tres numeraciones internas,
    ninguna la del lienzo) o nada, y en un flujo de 50 bloques había que
    buscarlo a ojo.
    """

    status_code = 400
    code = "automation_invalid"

    def __init__(self, detail=None, *, code: str | None = None, node_id: str | None = None) -> None:
        super().__init__(detail, code=code)
        self.node_id = node_id

    def to_response(self) -> dict:
        response = super().to_response()
        if self.node_id:
            response["target"] = self.node_id
        return response


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


MALFORMED_INPUT = "No se pudo leer lo que se guardó. Recarga la página e inténtalo de nuevo; si importaste un JSON, revísalo."


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
