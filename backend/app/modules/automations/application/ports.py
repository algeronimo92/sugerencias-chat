"""Puertos del motor de automatizaciones.

La aplicación no sabe de SQL: guarda y lee ejecuciones, reglas y referencias
a través de estos contratos, que ``app.composition`` conecta con sus
implementaciones en ``infrastructure``. Los tests usan versiones en memoria
(``tests/automation_fakes.py``).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.modules.automations.domain.execution import Execution, Rule


class ExecutionAlreadyRunning(Exception):
    """El índice de flujos manuales en curso rechazó una segunda ejecución
    del mismo flujo sobre el mismo lead."""


class ExecutionStore(Protocol):
    """Las ejecuciones y el estado que el motor guarda mientras las recorre."""

    async def load(self, execution_id: int) -> tuple[Execution | None, Rule | None]: ...

    async def rule(self, rule_id: int) -> Rule | None: ...

    async def save(self, execution_id: int, **values) -> bool:
        """Escribe el estado de una ejecución salvo que ya esté ``skipped``
        (alguien la canceló mientras corría). False en ese caso."""

    async def completed_since(self, rule_id: int, since: datetime) -> int: ...

    async def completed_for_lead_since(self, rule_id: int, lead_id: str, since: datetime) -> bool: ...

    async def flow_definition(self, rule_id: int, version: int) -> dict | None: ...

    async def schedule_child(
        self, *, rule: Rule, parent: Execution, event_key: str, payload: dict, now: datetime,
    ) -> int | None:
        """Agenda la ejecución de un flujo hijo, o devuelve la que ya existía
        con esa clave."""

    async def advance_round_robin(self, rule_id: int, node_id: str, now: datetime) -> int:
        """Suma un turno al bloque y devuelve el contador nuevo, en una sola
        sentencia para que dos ejecuciones no se lleven el mismo turno."""

    async def round_robin_counter(self, rule_id: int, node_id: str) -> int: ...

    async def claim_due(self, now: datetime, limit: int) -> tuple[list[int], list[int]]:
        """Congela lo vencido de leads pausados y reclama lo demás para
        correrlo. Devuelve (congeladas, reclamadas)."""

    async def find_by_event_key(self, rule_id: int, event_key: str) -> int | None: ...

    async def view(self, execution_id: int) -> dict | None:
        """La ejecución tal como la muestra el historial."""

    async def requeue(self, execution_id: int, now: datetime, *, override_by_user_id: int | None) -> bool:
        """Vuelve a la cola una ejecución failed o skipped."""

    async def pause_lead(self, lead_id: str, now: datetime) -> int: ...

    async def resume_lead(self, lead_id: str, now: datetime) -> int: ...

    async def pause(self, execution_id: int, now: datetime) -> bool: ...

    async def resume(self, execution_id: int, now: datetime) -> bool: ...

    async def cancel(self, execution_id: int, now: datetime) -> bool: ...


class RuleStore(Protocol):
    """Las reglas y las versiones publicadas de los flujos visuales."""

    async def get(self, rule_id: int) -> dict | None: ...

    async def insert(self, values: dict, *, user_id: int, now: datetime) -> int: ...

    async def update(self, rule_id: int, values: dict) -> bool:
        """False si la regla no existe o está borrada."""

    async def lock_active_statuses(self, rule_id: int) -> list[str] | None:
        """Bloquea la regla y sus ejecuciones programadas o en curso para
        borrarla. None si la regla no existe."""

    async def retire(self, rule_id: int, now: datetime) -> int:
        """Borra la regla (sin destruir su historial) y omite lo que tenía
        pendiente. Devuelve cuántas ejecuciones canceló."""

    async def publish(self, rule_id: int, values: dict, *, version: int, now: datetime) -> None: ...

    async def flow_targets(self) -> dict[int, dict]:
        """Reglas no borradas por id, para validar las invocaciones."""

    async def rename_service(self, old_name: str, new_name: str, rename) -> None: ...


class SchedulingStore(Protocol):
    """Alta de ejecuciones a partir de los eventos del negocio."""

    async def schedule(
        self,
        trigger_type: str,
        lead_id: str,
        event_key: str,
        payload: dict | None = None,
        *,
        rule_id: int | None = None,
        started_by_user_id: int | None = None,
        start_source: str = "system",
    ) -> int:
        """Cuántas ejecuciones agendó. Levanta ``ExecutionAlreadyRunning``
        si es un flujo manual que ya está en curso para ese lead."""

    async def lead_created_activity(self, lead_id: str) -> int | None: ...

    async def is_first_message(self, lead_id: str) -> bool:
        """El chat tiene un solo mensaje y el alta del lead no quedó
        registrada: el primer mensaje es lo que lo creó."""

    async def cancel_customer_deadlines(self, lead_id: str, now: datetime) -> int: ...

    async def schedule_customer_deadlines(self, message: dict, *, rule_id: int | None = None) -> int: ...

    async def recent_seller_silences(self, rule_id: int) -> list[dict]:
        """Chats recientes cuyo último mensaje es del vendedor, para crear
        una sola vez los vencimientos al activar una regla."""


class ReferenceChecker(Protocol):
    """Lo que solo la base sabe de lo que una regla menciona."""

    async def inactive_users(self, ids: set[int]) -> set[int]: ...

    async def inactive_tags(self, ids: set[int]) -> set[int]: ...

    async def unusable_templates(self, ids: set[int]) -> set[int]:
        """Las que no son plantillas internas activas sin botones ni listas."""

    async def missing_media_assets(self, ids: set[int]) -> set[int]: ...

    async def stage_problem(self, keys: set[str], *, active_only: bool) -> str | None:
        """El motivo por el que alguna etapa no sirve, o None."""


@dataclass(frozen=True)
class AutomationPorts:
    executions: ExecutionStore
    rules: RuleStore
    scheduling: SchedulingStore
    references: ReferenceChecker


_ports: AutomationPorts | None = None


def provide_automation_ports(ports: AutomationPorts) -> None:
    global _ports
    _ports = ports


def automation_ports() -> AutomationPorts:
    if _ports is None:
        raise RuntimeError("Los puertos de automatizaciones no están configurados (app.composition)")
    return _ports
