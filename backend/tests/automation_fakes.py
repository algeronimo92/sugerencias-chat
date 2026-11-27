"""Puertos del motor de automatizaciones en memoria.

Reemplazan al SQL en los tests de la aplicación: el motor, los comandos de
gestión y los disparadores corren contra estos dobles sin PostgreSQL. Lo que
depende de cómo responde la base (locks, índices, ``SKIP LOCKED``) se prueba
contra PostgreSQL real.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest

from app.core.events import DomainEvent
from app.modules.automations.application import ports as automation_ports_module
from app.modules.automations.application.ports import AutomationPorts, ExecutionAlreadyRunning
from app.modules.automations.domain.delivery import advance
from app.modules.automations.ports.types import AutomationExecutionStatus


class InMemoryExecutionStore:
    def __init__(self) -> None:
        self.executions: dict[int, object] = {}
        self.rules: dict[int, object] = {}
        self.saves: list[tuple[int, dict]] = []
        self.flow_versions: dict[tuple[int, int], dict] = {}
        self.round_robin: dict[tuple[int, str], int] = {}
        self.children: list[dict] = []
        self.due: list[int] = []
        self.lead_resumes: list[str] = []
        # lead_id -> mensajes automáticos de las últimas 24 h.
        self.queued_for_lead: dict[str, int] = {}
        # message_id -> (execution_id, estado de entrega).
        self.messages: dict[int, tuple[int, str]] = {}
        self._ids = itertools.count(1000)

    def add(self, execution, rule=None):
        self.executions[execution.id] = execution
        if rule is not None:
            self.rules[rule.id] = rule
        return execution

    async def load(self, execution_id):
        execution = self.executions.get(execution_id)
        rule = self.rules.get(execution.rule_id) if execution is not None else None
        return execution, rule

    async def rule(self, rule_id):
        return self.rules.get(rule_id)

    async def save(self, execution_id, **values):
        self.saves.append((execution_id, values))
        execution = self.executions.get(execution_id)
        if execution is None:
            return True
        if getattr(execution, "status", None) in {
            AutomationExecutionStatus.SKIPPED, AutomationExecutionStatus.CANCELLED,
        }:
            return False
        for name, value in values.items():
            setattr(execution, name, value)
        return True

    def _completed(self, rule_id, since, lead_id=None):
        return [
            execution for execution in self.executions.values()
            if execution.rule_id == rule_id
            and getattr(execution, "status", None) == AutomationExecutionStatus.COMPLETED
            and getattr(execution, "finished_at", None) is not None
            and execution.finished_at >= since
            and (lead_id is None or execution.lead_id == lead_id)
        ]

    async def completed_since(self, rule_id, since):
        return len(self._completed(rule_id, since))

    async def completed_for_lead_since(self, rule_id, lead_id, since):
        return bool(self._completed(rule_id, since, lead_id))

    async def started_for_lead_since(self, rule_id, lead_id, since, *, exclude_event_key):
        recent = [
            execution for execution in self.executions.values()
            if execution.rule_id == rule_id and execution.lead_id == lead_id
            and getattr(execution, "created_at", None) is not None and execution.created_at >= since
            and getattr(execution, "event_key", None) != exclude_event_key
            and getattr(execution, "status", None) not in {
                AutomationExecutionStatus.FAILED, AutomationExecutionStatus.CANCELLED,
                AutomationExecutionStatus.SKIPPED,
            }
        ]
        recent.sort(key=lambda execution: execution.created_at)
        return getattr(recent[-1], "start_source", "system") if recent else None

    async def flow_definition(self, rule_id, version):
        return self.flow_versions.get((rule_id, version))

    async def schedule_child(self, *, rule, parent, event_key, payload, now):
        for child in self.children:
            if child["rule_id"] == rule.id and child["event_key"] == event_key:
                return child["id"]
        child = {
            "id": next(self._ids), "rule_id": rule.id, "lead_id": parent.lead_id,
            "event_key": event_key, "event_payload": payload, "scheduled_for": now,
            "started_by_user_id": parent.started_by_user_id,
        }
        self.children.append(child)
        return child["id"]

    async def advance_round_robin(self, rule_id, node_id, now):
        key = (rule_id, node_id)
        self.round_robin[key] = self.round_robin.get(key, 0) + 1
        return self.round_robin[key]

    async def round_robin_counter(self, rule_id, node_id):
        return self.round_robin.get((rule_id, node_id), 0)

    async def claim_due(self, now, limit):
        claimed, self.due = self.due[:limit], self.due[limit:]
        return claimed

    async def find_by_event_key(self, rule_id, event_key):
        for execution in self.executions.values():
            if execution.rule_id == rule_id and getattr(execution, "event_key", None) == event_key:
                return execution.id
        return None

    async def view(self, execution_id):
        execution = self.executions.get(execution_id)
        return None if execution is None else {"id": execution.id, "status": execution.status}

    def _transition(self, execution_id, allowed, **values):
        execution = self.executions.get(execution_id)
        if execution is None or execution.status not in allowed:
            return False
        for name, value in values.items():
            setattr(execution, name, value)
        return True

    async def requeue(self, execution_id, now, *, override_by_user_id):
        return self._transition(
            execution_id, {AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED},
            status=AutomationExecutionStatus.SCHEDULED, scheduled_for=now, error=None, error_code=None, attempts=0,
            window_override_by_user_id=override_by_user_id,
        )

    async def resume_lead(self, lead_id, now):
        self.lead_resumes.append(lead_id)
        return sum(
            self._transition(execution.id, {AutomationExecutionStatus.PAUSED},
                             status=AutomationExecutionStatus.SCHEDULED, paused_at=None, pause_scope=None)
            for execution in list(self.executions.values())
            if execution.lead_id == lead_id and getattr(execution, "pause_scope", None) != "execution"
        )

    async def pause(self, execution_id, now):
        return self._transition(
            execution_id, {AutomationExecutionStatus.SCHEDULED},
            status=AutomationExecutionStatus.PAUSED, paused_at=now, pause_scope="execution",
        )

    async def resume(self, execution_id, now):
        return self._transition(
            execution_id, {AutomationExecutionStatus.PAUSED},
            status=AutomationExecutionStatus.SCHEDULED, paused_at=None, pause_scope=None,
        )

    async def track_messages(self, execution_id, message_ids, now):
        for message_id in message_ids:
            self.messages.setdefault(message_id, (execution_id, "pending"))

    async def messages_queued_for_lead_since(self, lead_id, since):
        return self.queued_for_lead.get(lead_id, 0)

    async def record_message_state(self, message_id, state, now, *, resent=False):
        if message_id not in self.messages:
            return None
        execution_id, current = self.messages[message_id]
        new_state = state if resent and current == "failed" else advance(current, state)
        self.messages[message_id] = (execution_id, new_state)
        return execution_id

    async def queued_message_ids(self, after_id, limit):
        from app.modules.automations.domain.delivery import message_ids_in

        ids = sorted(execution_id for execution_id in self.executions if execution_id > after_id)[:limit]
        return [(execution_id, message_ids_in(self.executions[execution_id].action_results)) for execution_id in ids]

    async def tracked_message_states(self, execution_ids):
        tracked = {execution_id: {} for execution_id in execution_ids}
        for message_id, (execution_id, state) in self.messages.items():
            if execution_id in tracked:
                tracked[execution_id][message_id] = state
        return tracked

    async def replace_message_states(self, execution_id, states, now):
        for message_id, state in states.items():
            self.messages[message_id] = (execution_id, state)

    async def dismiss(self, execution_id, now):
        execution = self.executions.get(execution_id)
        if execution is None:
            return False
        dismissable = execution.status in {AutomationExecutionStatus.FAILED, AutomationExecutionStatus.PAUSED}
        if not dismissable and getattr(execution, "delivery_state", None) != "failed":
            return False
        execution.attention_dismissed_at = now
        return True

    async def cancel(self, execution_id, now):
        return self._transition(
            execution_id,
            {AutomationExecutionStatus.SCHEDULED, AutomationExecutionStatus.RUNNING, AutomationExecutionStatus.PAUSED},
            status=AutomationExecutionStatus.CANCELLED, error="Cancelada manualmente", finished_at=now,
        )


class InMemoryRuleStore:
    def __init__(self) -> None:
        self.rules: dict[int, dict] = {}
        self.published: list[tuple[int, dict, int]] = []
        self.renames: list[tuple[str, str]] = []
        self._ids = itertools.count(1)

    async def get(self, rule_id):
        rule = self.rules.get(rule_id)
        return None if rule is None or rule.get("deleted_at") else dict(rule)

    async def insert(self, values, *, user_id, now):
        rule_id = next(self._ids)
        while rule_id in self.rules:
            rule_id = next(self._ids)
        self.rules[rule_id] = {
            "id": rule_id, "flow_definition": {}, "published_flow_definition": None,
            "flow_version": 0, "max_executions_per_hour": None,
            "conditions": {}, "trigger_config": {},
            **values, "created_by_user_id": user_id, "created_at": now, "updated_at": now,
        }
        return rule_id

    async def update(self, rule_id, values):
        rule = self.rules.get(rule_id)
        if rule is None or rule.get("deleted_at"):
            return False
        rule.update(values)
        return True

    async def count_active(self, *, exclude_rule_id=None):
        return sum(
            1 for rule_id, rule in self.rules.items()
            if rule.get("is_active") and not rule.get("deleted_at") and rule_id != exclude_rule_id
        )

    async def lock_active_statuses(self, rule_id):
        rule = self.rules.get(rule_id)
        if rule is None or rule.get("deleted_at"):
            return None
        return list(rule.get("active_statuses", []))

    async def retire(self, rule_id, now):
        rule = self.rules[rule_id]
        rule.update(is_active=False, deleted_at=now)
        return len([status for status in rule.get("active_statuses", []) if status == AutomationExecutionStatus.SCHEDULED])

    async def publish(self, rule_id, values, *, version, now):
        self.published.append((rule_id, values, version))
        self.rules[rule_id].update(
            name=values["name"], trigger_type=values["trigger_type"], trigger_config=values["trigger_config"],
            conditions=values["conditions"], flow_definition=values["flow_definition"],
            published_flow_definition=values["flow_definition"], flow_version=version, is_active=True,
        )

    async def flow_targets(self):
        return {
            rule_id: {
                "id": rule_id, "name": rule["name"],
                "published_flow_definition": rule.get("published_flow_definition"),
            }
            for rule_id, rule in self.rules.items()
            if not rule.get("deleted_at")
        }

    async def rename_service(self, old_name, new_name, rename):
        self.renames.append((old_name, new_name))

    async def rules_referencing_service(self, name, references):
        fields = ("conditions", "flow_definition", "published_flow_definition")
        return [
            (rule_id, rule.get("name")) for rule_id, rule in self.rules.items()
            if not rule.get("deleted_at") and any(references(rule.get(field), name) for field in fields)
        ]


class FakeScheduling:
    def __init__(self) -> None:
        self.scheduled: list[dict] = []
        self.created_per_call = 1
        self.conflict = False
        self.activity_ids: dict[str, int] = {}
        self.first_message: set[str] = set()
        self.cancelled_deadlines: list[str] = []
        self.team_replies: list[str] = []
        self.stopped_by_team_reply = 0
        self.deadline_messages: list[tuple[dict, int | None]] = []
        self.silences: dict[int, list[dict]] = {}

    async def schedule(self, trigger_type, lead_id, event_key, payload=None, *, rule_id=None,
                       started_by_user_id=None, start_source="system"):
        if self.conflict:
            raise ExecutionAlreadyRunning()
        self.scheduled.append({
            "trigger_type": trigger_type, "lead_id": lead_id, "event_key": event_key, "payload": payload,
            "rule_id": rule_id, "started_by_user_id": started_by_user_id, "start_source": start_source,
        })
        return self.created_per_call

    async def lead_created_activity(self, lead_id):
        return self.activity_ids.get(lead_id)

    async def is_first_message(self, lead_id):
        return lead_id in self.first_message

    async def stop_for_team_reply(self, lead_id, now):
        self.team_replies.append(lead_id)
        return self.stopped_by_team_reply

    async def cancel_customer_deadlines(self, lead_id, now):
        self.cancelled_deadlines.append(lead_id)
        return 0

    async def schedule_customer_deadlines(self, message, *, rule_id=None):
        self.deadline_messages.append((message, rule_id))
        return 0

    async def recent_seller_silences(self, rule_id):
        return self.silences.get(rule_id, [])


@dataclass
class FakeReferences:
    """Todo existe y está activo salvo lo que el test marque."""

    inactive_user_ids: set[int] = field(default_factory=set)
    inactive_tag_ids: set[int] = field(default_factory=set)
    unusable_template_ids: set[int] = field(default_factory=set)
    missing_media_ids: set[int] = field(default_factory=set)
    stage_problems: dict[bool, str] = field(default_factory=dict)
    checked_stages: list[tuple[frozenset, bool]] = field(default_factory=list)

    async def inactive_users(self, ids):
        return set(ids) & self.inactive_user_ids

    async def inactive_tags(self, ids):
        return set(ids) & self.inactive_tag_ids

    async def unusable_templates(self, ids):
        return set(ids) & self.unusable_template_ids

    async def missing_media_assets(self, ids):
        return set(ids) & self.missing_media_ids

    async def stage_problem(self, keys, *, active_only):
        self.checked_stages.append((frozenset(keys), active_only))
        return self.stage_problems.get(active_only)


@dataclass
class AutomationWorld:
    executions: InMemoryExecutionStore
    rules: InMemoryRuleStore
    scheduling: FakeScheduling
    references: FakeReferences
    published: list[DomainEvent]

    def of(self, event_type):
        return [event for event in self.published if isinstance(event, event_type)]


def install_automation_ports(monkeypatch) -> AutomationWorld:
    from app.db import uow

    world = AutomationWorld(
        executions=InMemoryExecutionStore(),
        rules=InMemoryRuleStore(),
        scheduling=FakeScheduling(),
        references=FakeReferences(),
        published=[],
    )
    monkeypatch.setattr(automation_ports_module, "_ports", AutomationPorts(
        executions=world.executions,
        rules=world.rules,
        scheduling=world.scheduling,
        references=world.references,
    ))

    async def record_after_commit(events_to_dispatch):
        world.published.extend(events_to_dispatch)

    async def record_publish(*events_to_publish, strict=False):
        world.published.extend(events_to_publish)

    class _FakeSession:
        async def close(self):
            pass

        def begin(self):
            return _FakeTransaction()

    class _FakeTransaction:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _FakeSession)
    monkeypatch.setattr(uow, "dispatch_after_commit", record_after_commit)
    for module in _modules_that_publish():
        monkeypatch.setattr(module, "publish", record_publish)
    return world


def _modules_that_publish():
    return []


@pytest.fixture
def in_memory_automations(monkeypatch) -> AutomationWorld:
    return install_automation_ports(monkeypatch)


def execution(**overrides):
    defaults = {
        "id": 100, "rule_id": 1, "lead_id": "4316bc30-f78c-57a2-8f98-bff9087678d6",
        "trigger_type": "manual", "status": AutomationExecutionStatus.SCHEDULED,
        "event_payload": {}, "flow_state": {}, "action_results": [], "started_by_user_id": None,
        "window_override_by_user_id": None, "start_source": "system", "error": None, "error_code": None,
        "finished_at": None, "event_key": None,
    }
    return SimpleNamespace(**{**defaults, **overrides})


def rule(**overrides):
    defaults = {
        "id": 1, "name": "Regla de prueba", "trigger_type": "manual", "is_active": True,
        "conditions": {}, "flow_version": 0,
        "published_flow_definition": None, "max_executions_per_hour": None,
        "created_by_user_id": 10, "deleted_at": None,
    }
    return SimpleNamespace(**{**defaults, **overrides})


async def validated_actions(actions: list[dict], references=None) -> list[dict]:
    """Acciones validadas como las valida un bloque del flujo: primero la
    forma y después lo que mencionan (etapas, etiquetas, plantillas...)."""
    from app.modules.automations.application.ports import automation_ports
    from app.modules.automations.application.validation import verify_references
    from app.modules.automations.domain.validation import ActionReferences, normalize_actions

    refs = ActionReferences()
    normalized = normalize_actions(actions, refs)
    await verify_references(refs, references or automation_ports().references)
    return normalized
