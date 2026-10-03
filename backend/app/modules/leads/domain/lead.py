"""Agregado ``Lead``: las reglas que valen venga de donde venga el cambio.

Un lead se mueve de etapa desde el kanban, desde n8n, desde una automatización
o desde el analista de IA. Antes cada camino reimplementaba la regla; ahora
todos pasan por estos métodos, que deciden qué cambia y qué queda auditado.
El agregado no persiste nada: acumula los cambios de columnas (``changes``) y
los registros de auditoría (``activities``) que el repositorio escribe en la
misma transacción.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from uuid import uuid4

from app.modules.leads.domain.stage import StageRule
from domain_types import INITIAL_LEAD_STAGE, AutomationTrigger

# Cuánto del último mensaje del cliente se congela en la auditoría del cambio
# de etapa: alcanza para entender por qué se movió sin guardar el chat entero.
TRIGGER_SNIPPET_MAX = 300

# Columnas que el sistema actualiza en cada mensaje para ordenar y filtrar la
# bandeja. Cambian todo el tiempo y no son una edición del lead.
BOOKKEEPING_FIELDS = frozenset({"ultimo_emisor", "ultimo_mensaje_at"})


@dataclass(frozen=True)
class Actor:
    """Quién hizo el cambio, tal como lo guarda la auditoría."""

    type: str
    user_id: int | None = None

    @classmethod
    def user(cls, user_id: int) -> Actor:
        return cls("user", user_id)

    @classmethod
    def agent(cls) -> Actor:
        return cls("agent")

    @classmethod
    def system(cls) -> Actor:
        return cls("system")

    @classmethod
    def of(cls, user_id: int | None) -> Actor:
        """Un usuario si se conoce, si no el sistema."""
        return cls.user(user_id) if user_id is not None else cls.system()


@dataclass(frozen=True)
class TriggerMessage:
    """Foto del último mensaje del cliente al momento de un cambio."""

    id: int
    content: str | None
    sent_at: str | None

    def snapshot(self) -> dict[str, Any]:
        content = (self.content or "").strip()
        if len(content) > TRIGGER_SNIPPET_MAX:
            content = content[:TRIGGER_SNIPPET_MAX] + "…"
        return {"id": self.id, "content": content, "sent_at": self.sent_at}


@dataclass(frozen=True)
class ActivityRecord:
    event_type: str
    actor: Actor
    old_value: dict | None = None
    new_value: dict | None = None
    metadata: dict | None = None


def audit_safe(values: dict) -> dict:
    """Las columnas de auditoría son JSONB: una fecha cruda rompe la
    serialización del driver. La fila del lead sigue recibiendo el valor real."""
    return {
        key: value.isoformat() if isinstance(value, (date, datetime)) else value
        for key, value in values.items()
    }


@dataclass(frozen=True)
class StageMove:
    old_stage: str
    new_stage: str


@dataclass(frozen=True)
class FieldChanges:
    old: dict[str, Any]
    new: dict[str, Any]
    event_type: str

    @property
    def fields(self) -> tuple[str, ...]:
        return tuple(self.new)


@dataclass
class Lead:
    """Estado del lead cargado para un cambio, con bloqueo de fila.

    ``values`` trae solo las columnas que el caso de uso necesita leer: el
    agregado no pretende reflejar la fila entera.
    """

    id: str
    stage: str
    lost_reason: str | None = None
    no_show_count: int = 0
    conversation_version: int = 0
    phone: str | None = None
    values: dict[str, Any] = field(default_factory=dict)
    changes: dict[str, Any] = field(default_factory=dict)
    activities: list[ActivityRecord] = field(default_factory=list)

    # --- Alta -------------------------------------------------------------

    @classmethod
    def register(cls, *, phone: str, name: str, actor: Actor, values: dict[str, Any]) -> Lead:
        """Un lead nuevo entra por la etapa inicial y su alta queda auditada."""
        lead = cls(id=str(uuid4()), stage=INITIAL_LEAD_STAGE, phone=phone)
        lead.changes.update(values, telefono=phone, nombre=name)
        lead.activities.append(ActivityRecord(
            AutomationTrigger.LEAD_CREATED, actor, new_value={"name": name, "phone": phone},
        ))
        return lead

    # --- Etapa ------------------------------------------------------------

    def move_to(
        self,
        target: StageRule,
        previous: StageRule | None,
        *,
        actor: Actor,
        now: datetime,
        lost_reason: str | None = None,
        metadata: dict | None = None,
        trigger: TriggerMessage | None = None,
    ) -> StageMove | None:
        """Mueve el lead a ``target``. ``None`` si ya estaba ahí.

        La razón de pérdida describe la situación actual, no la historia:
        entra al pasar a una etapa ``lost`` y se limpia al salir hacia una que
        no lo es. Lo dicho queda igual en la auditoría (``metadata.reason``).
        """
        if target.key == self.stage:
            return None
        metadata = dict(metadata or {})
        reason = (lost_reason or "").strip()
        if target.is_lost:
            if reason:
                self.lost_reason = reason
                self.changes["razon_perdido"] = reason
                metadata["reason"] = reason
        elif previous is not None and previous.is_lost:
            self.lost_reason = None
            self.changes["razon_perdido"] = None
        if trigger is not None:
            metadata["trigger_message"] = trigger.snapshot()

        move = StageMove(self.stage, target.key)
        self.stage = target.key
        self.changes["estado"] = target.key
        self.changes["updated_at"] = now
        self.activities.append(ActivityRecord(
            AutomationTrigger.STAGE_CHANGED, actor,
            old_value={"stage": move.old_stage}, new_value={"stage": move.new_stage},
            metadata=metadata or None,
        ))
        return move

    # --- Datos ------------------------------------------------------------

    def update(
        self,
        values: dict[str, Any],
        *,
        actor: Actor,
        now: datetime,
        metadata: dict | None = None,
    ) -> FieldChanges | None:
        """Aplica solo lo que cambia. Abrir o cerrar la conversación es un
        evento propio, con sus marcas de tiempo y una versión nueva al abrir."""
        changed = {key: value for key, value in values.items() if self.values.get(key) != value}
        if not changed:
            return None
        old = {key: self.values.get(key) for key in changed}
        self.values.update(changed)
        self.changes.update(changed)

        event_type = "lead_updated"
        if "conversacion_abierta" in changed:
            if changed["conversacion_abierta"]:
                event_type = "conversation_opened"
                self.conversation_version += 1
                self.changes.update(
                    conversacion_abierta_at=now,
                    conversacion_cerrada_at=None,
                    conversacion_version=self.conversation_version,
                )
            else:
                event_type = "conversation_closed"
                self.changes["conversacion_cerrada_at"] = now
        if "razon_perdido" in changed:
            self.lost_reason = changed["razon_perdido"]
        self.changes["updated_at"] = now
        self.activities.append(ActivityRecord(
            event_type, actor, old_value=audit_safe(old), new_value=audit_safe(changed), metadata=metadata,
        ))
        return FieldChanges(old, changed, event_type)

    def change_phone(self, new_phone: str, *, actor: Actor, now: datetime) -> None:
        """El teléfono es un alias externo: cambiarlo no cambia la identidad."""
        old_phone = self.phone
        self.phone = new_phone
        self.changes.update(telefono=new_phone, updated_at=now)
        self.activities.append(ActivityRecord(
            "lead_updated", actor, old_value={"phone": old_phone}, new_value={"phone": new_phone},
        ))

    def register_no_show(self, *, actor: Actor, now: datetime) -> int:
        """El vendedor confirma que el cliente no llegó a la cita. Es una
        acción humana a propósito: el sistema no puede saberlo por sí solo."""
        self.no_show_count += 1
        self.changes.update(contador_noshow=self.no_show_count, updated_at=now)
        self.activities.append(ActivityRecord(
            "no_show_registered", actor, new_value={"contador_noshow": self.no_show_count},
        ))
        return self.no_show_count

    def record_tag(self, tag: dict[str, Any], *, added: bool, actor: Actor) -> None:
        self.activities.append(ActivityRecord(
            "tag_added" if added else "tag_removed", actor,
            new_value={"tag": tag} if added else None,
            old_value=None if added else {"tag": tag},
        ))
