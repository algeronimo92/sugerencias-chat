"""``SchedulingStore`` sobre PostgreSQL: el alta de ejecuciones.

La clave (rule_id, event_key) es única: el mismo evento descubierto dos
veces (webhook y barrido, o dos réplicas a la vez) agenda una sola ejecución.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, not_, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.core.time_format import iso_utc
from app.db.models.automations import AutomationExecution, AutomationRule
from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead, LeadActivity
from app.db.uow import session_scope
from app.modules.automations.domain.types import AutomationExecutionStatus, AutomationTrigger
from app.modules.automations.application.ports import ExecutionAlreadyRunning
from app.modules.automations.domain.execution import initial_flow_state
from app.modules.automations.domain.limits import OVERDUE_LOOKBACK_GRACE_MINUTES, TRIGGER_TYPES
from app.modules.automations.domain.rules import message_sent_at
from app.modules.automations.infrastructure.sql_executions import _has_started

TEAM_REPLIED = "Alguien del equipo le escribió al cliente"

logger = logging.getLogger(__name__)

async def schedule_in_session(
    session,
    trigger_type: AutomationTrigger,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
    started_by_user_id: int | None = None,
    start_source: str = "system",
) -> int:
    if trigger_type not in TRIGGER_TYPES:
        return 0
    stmt = select(
        AutomationRule.id, AutomationRule.flow_version,
    ).where(
        AutomationRule.is_active.is_(True), AutomationRule.trigger_type == trigger_type
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationRule.id == rule_id)
    lead = await session.get(Lead, lead_id)
    if lead is None:
        # debug y no warning: el watcher redescubre mensajes de chats sin
        # lead cada ciclo y un warning por chat cada 10s inunda el log.
        logger.debug("Evento de automatización ignorado: lead %s no existe", lead_id)
        return 0
    # La pausa solo corta los triggers de sistema. Un flujo manual (el
    # vendedor tocó "Iniciar flujo") se respeta igual: lo pidió a propósito.
    if lead.automatizacion_pausada and start_source == "system":
        logger.debug("Evento de automatización ignorado: %s tiene la automatización pausada", lead_id)
        return 0
    rules = (await session.execute(stmt)).mappings().all()
    now = datetime.now(timezone.utc)
    created = 0
    for rule in rules:
        result = await session.execute(
            pg_insert(AutomationExecution).values(
                rule_id=rule["id"],
                lead_id=lead_id,
                trigger_type=trigger_type,
                event_key=event_key,
                event_payload=payload or {},
                status=AutomationExecutionStatus.SCHEDULED,
                scheduled_for=now,
                action_results=[],
                flow_state=initial_flow_state(rule["flow_version"]),
                created_at=now,
                start_source=start_source,
                started_by_user_id=started_by_user_id,
            ).on_conflict_do_nothing(
                index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
            )
        )
        created += result.rowcount
    return created


class SqlSchedulingStore:
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
        try:
            async with session_scope() as session:
                return await schedule_in_session(
                    session, trigger_type, lead_id, event_key, payload,
                    rule_id=rule_id, started_by_user_id=started_by_user_id, start_source=start_source,
                )
        except IntegrityError as exc:
            # El índice único parcial de flujos manuales en curso
            # (uq_automation_executions_manual_active_per_lead): un doble
            # click o dos vendedores sobre el mismo lead.
            if start_source == "manual":
                raise ExecutionAlreadyRunning() from exc
            raise

    async def lead_created_activity(self, lead_id: str) -> int | None:
        async with session_scope() as session:
            return await session.scalar(
                select(LeadActivity.id).where(
                    LeadActivity.lead_id == lead_id,
                    LeadActivity.event_type == AutomationTrigger.LEAD_CREATED,
                ).order_by(LeadActivity.id.desc()).limit(1)
            )

    async def is_first_message(self, lead_id: str) -> bool:
        async with session_scope() as session:
            message_count = await session.scalar(
                select(func.count(WspMessage.id)).where(WspMessage.chat_id == lead_id)
            )
            has_recorded_creation = await session.scalar(
                select(LeadActivity.id).where(
                    LeadActivity.lead_id == lead_id,
                    LeadActivity.event_type == AutomationTrigger.LEAD_CREATED,
                ).limit(1)
            )
        return message_count == 1 and not has_recorded_creation

    async def cancel_customer_deadlines(self, lead_id: str, now: datetime) -> int:
        """Invalida el cierre pendiente cuando el cliente vuelve a responder.

        Un seguimiento que ya empezó y está en una espera también se corta: el
        cliente contestó, no hay nada que seguir persiguiendo. La excepción es
        el que está justamente esperando esa respuesta (un bloque Pausa con
        «llega un mensaje» o una Pregunta): ese la necesita para elegir por
        dónde sigue, y cancelarlo acá le ganaba la carrera al worker que lo
        iba a reanudar."""
        waits_for_this_reply = or_(
            AutomationExecution.flow_state.has_key("awaiting"),
            func.coalesce(AutomationExecution.flow_state["awaiting_message"].astext, "") == "true",
        )
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.lead_id == lead_id,
                AutomationExecution.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.started_at.is_(None),
                not_(waits_for_this_reply),
            ).values(
                status=AutomationExecutionStatus.SKIPPED,
                error="El cliente respondió antes del vencimiento",
                finished_at=now,
            ))
        return result.rowcount or 0

    async def stop_for_team_reply(self, lead_id: str, now: datetime) -> int:
        """Una persona del equipo le escribió al cliente: el seguimiento
        automático que estaba pendiente ya no hace falta.

        Solo lo que arrancó el sistema: una secuencia lanzada a mano es algo
        que esa misma persona decidió mandar. Y no el vencimiento de «cliente
        sin responder» que todavía no corrió: lo arma justamente ese mensaje
        del equipo."""
        opted_in = select(AutomationRule.id).where(
            AutomationRule.conditions["stop_when_team_replies"].astext == "true",
        )
        async with session_scope() as session:
            result = await session.execute(update(AutomationExecution).where(
                AutomationExecution.lead_id == lead_id,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.start_source == "system",
                AutomationExecution.rule_id.in_(opted_in),
                or_(
                    _has_started(AutomationExecution),
                    AutomationExecution.trigger_type != AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
                ),
            ).values(
                status=AutomationExecutionStatus.CANCELLED,
                error=TEAM_REPLIED,
                finished_at=now,
            ))
        return result.rowcount or 0

    async def schedule_customer_deadlines(self, message: dict, *, rule_id: int | None = None) -> int:
        """Crea o mueve el vencimiento de cada regla sin recorrer otros chats.

        La clave se ancla al último mensaje del cliente. Así varios mensajes
        del vendedor mueven el mismo temporizador y un mensaje enviado por la
        propia automatización no genera un ciclo infinito de nuevos
        follow-ups.
        """
        lead_id = message.get("chat_id")
        message_key = str(message.get("message_id") or "")
        if not lead_id or not message_key or message.get("sender") != "vendedor":
            return 0

        rule_stmt = select(
            AutomationRule.id,
            AutomationRule.trigger_config,
            AutomationRule.flow_version,
        ).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        )
        if rule_id is not None:
            rule_stmt = rule_stmt.where(AutomationRule.id == rule_id)

        now = datetime.now(timezone.utc)
        sent_at = message_sent_at(message.get("sent_at"), fallback=now)
        async with session_scope() as session:
            lead = await session.get(Lead, lead_id)
            if lead is None or lead.automatizacion_pausada:
                return 0
            rules = (await session.execute(rule_stmt)).mappings().all()
            if not rules:
                return 0
            customer_anchor = await session.scalar(select(WspMessage.id).where(
                WspMessage.chat_id == lead_id,
                WspMessage.sender == "cliente",
            ).order_by(WspMessage.sent_at.desc(), WspMessage.id.desc()).limit(1))
            event_key = (
                f"silence:{customer_anchor}"
                if customer_anchor is not None
                else f"silence:none:{lead_id}"
            )
            changed = 0
            for rule in rules:
                minutes = max(1, int((rule["trigger_config"] or {}).get("minutes", 1)))
                scheduled_for = sent_at + timedelta(minutes=minutes)
                payload = {
                    "last_message_id": message_key,
                    "last_sender": "vendedor",
                    "last_message_at": iso_utc(sent_at),
                    "deadline_at": iso_utc(scheduled_for),
                }
                flow_state = initial_flow_state(rule["flow_version"])
                result = await session.execute(
                    pg_insert(AutomationExecution).values(
                        rule_id=rule["id"],
                        lead_id=lead_id,
                        trigger_type=AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
                        event_key=event_key,
                        event_payload=payload,
                        status=AutomationExecutionStatus.SCHEDULED,
                        scheduled_for=scheduled_for,
                        action_results=[],
                        flow_state=flow_state,
                        created_at=now,
                        start_source="system",
                    ).on_conflict_do_update(
                        index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key],
                        set_={
                            "event_payload": payload,
                            "scheduled_for": scheduled_for,
                            "flow_state": flow_state,
                            "error": None,
                            "finished_at": None,
                        },
                        # Solo el vencimiento que todavía no corrió. Una espera
                        # del flujo deja la fila en SCHEDULED y sin
                        # started_at, igual que una sin empezar: sin mirar
                        # si ya dio algún paso, el mensaje que el propio
                        # flujo acababa de enviar lo reiniciaba desde el
                        # principio y lo mandaba otra vez, en bucle.
                        where=and_(
                            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                            AutomationExecution.started_at.is_(None),
                            not_(_has_started(AutomationExecution)),
                        ),
                    )
                )
                changed += result.rowcount or 0
        return changed

    async def recent_seller_silences(self, rule_id: int) -> list[dict]:
        async with session_scope() as session:
            rule = (await session.execute(select(
                AutomationRule.id,
                AutomationRule.trigger_config,
            ).where(
                AutomationRule.id == rule_id,
                AutomationRule.is_active.is_(True),
                AutomationRule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
            ))).mappings().first()
            if rule is None:
                return []
            minutes = max(1, int((rule["trigger_config"] or {}).get("minutes", 1)))
            lookback = datetime.now(timezone.utc) - timedelta(
                minutes=minutes + OVERDUE_LOOKBACK_GRACE_MINUTES
            )
            last_message = select(
                WspMessage.id,
                WspMessage.wa_message_id,
                WspMessage.chat_id,
                WspMessage.sender,
                WspMessage.sent_at,
            ).where(WspMessage.sent_at >= lookback).order_by(
                WspMessage.chat_id,
                WspMessage.sent_at.desc(),
                WspMessage.id.desc(),
            ).distinct(WspMessage.chat_id).subquery()
            rows = (await session.execute(select(last_message).join(
                Lead, Lead.id == last_message.c.chat_id
            ).where(
                last_message.c.sender == "vendedor",
                Lead.automatizacion_pausada.is_(False),
            ).limit(500))).mappings().all()
        return [dict(row) for row in rows]
