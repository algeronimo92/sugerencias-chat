"""Quién puede usar el asistente IA y cuánto.

La plataforma habilita el asistente por negocio y le fija una cuota mensual
(``public.organizations``); el consumo se cuenta en los ``ai_jobs`` del propio
schema tenant. El negocio no configura nada de esto: solo lo usa.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func, or_, select

from app.db.models.ai import AIJob
from app.db.models.control import Organization
from app.db.session import control_session
from app.modules.ai.ai_job_tokens import signing_key_configured
from app.modules.auth.public import try_send_operational_alert
from app.modules.platform.public import platform_setting
from app.tenancy.context import get_current_tenant
from app.db.uow import session_scope
from app.modules.ai.application.ports import AiUnavailable

# Operaciones que invocan un modelo a pedido de un usuario del negocio.
BILLABLE_OPERATIONS = ("rag", "analyst")
# Un job que entregó resultado, o que sigue vivo y todavía puede entregarlo.
# Los fallidos, los vencidos y los pendientes cuyo plazo ya pasó (nadie los
# marcó como vencidos) no descuentan cuota.
_DELIVERED_STATUSES = ("succeeded", "applied")
_IN_FLIGHT_STATUSES = ("pending", "running")
# Workflow que atiende cada operación, configurado en la plataforma.
_WORKFLOW_URL_KEYS = {"rag": "n8n_webhook_url", "analyst": "n8n_analyst_webhook_url"}


@dataclass(frozen=True, slots=True)
class AIEntitlement:
    enabled: bool
    monthly_quota: int | None


# El error es el del puerto: los casos de uso lo atrapan sin conocer este módulo.
AIUnavailableError = AiUnavailable


def month_start(now: datetime | None = None) -> datetime:
    """Inicio del mes calendario en UTC, que es la zona del servidor."""

    now = now or datetime.now(timezone.utc)
    return now.astimezone(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def get_entitlement(organization_id: UUID | str) -> AIEntitlement:
    async with control_session() as session:
        row = (
            await session.execute(
                select(Organization.ai_enabled, Organization.ai_monthly_quota).where(
                    Organization.id == str(organization_id)
                )
            )
        ).first()
    if row is None:
        return AIEntitlement(enabled=False, monthly_quota=None)
    return AIEntitlement(enabled=bool(row.ai_enabled), monthly_quota=row.ai_monthly_quota)


async def count_usage_this_month() -> int:
    """Generaciones del mes en el schema del tenant activo."""

    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        value = await session.scalar(
            select(func.count())
            .select_from(AIJob)
            .where(
                AIJob.operation.in_(BILLABLE_OPERATIONS),
                AIJob.created_at >= month_start(now),
                or_(
                    AIJob.status.in_(_DELIVERED_STATUSES),
                    and_(AIJob.status.in_(_IN_FLIGHT_STATUSES), AIJob.expires_at > now),
                ),
            )
        )
    return int(value or 0)


async def usage_summary() -> dict:
    """Estado del asistente para el negocio activo (lo que ve su UI)."""

    context = get_current_tenant()
    if context is None:
        # Instalación single-tenant: no hay plano de control que limite.
        return {"enabled": True, "monthly_quota": None, "used_this_month": 0, "remaining": None}
    entitlement = await get_entitlement(context.organization_id)
    used = await count_usage_this_month()
    remaining = (
        max(entitlement.monthly_quota - used, 0)
        if entitlement.monthly_quota is not None
        else None
    )
    return {
        "enabled": entitlement.enabled,
        "monthly_quota": entitlement.monthly_quota,
        "used_this_month": used,
        "remaining": remaining,
    }


async def platform_ready(operation: str) -> bool:
    """La plataforma tiene lo necesario para atender la operación: el secreto
    que firma los jobs y la URL del workflow."""

    if not signing_key_configured():
        return False
    return bool(await platform_setting(_WORKFLOW_URL_KEYS[operation]))


async def _notify_quota(entitlement: AIEntitlement, used: int) -> None:
    quota = entitlement.monthly_quota
    if quota is None or quota <= 0:
        return
    period = month_start().strftime("%Y-%m")
    if used >= quota:
        await try_send_operational_alert(
            event_key=f"ai-quota-exhausted:{period}",
            event_type="ai_quota_exhausted",
            subject="La cuota de IA se agotó",
            title="Cuota mensual de IA agotada",
            message=(
                f"El negocio usó las {quota} generaciones incluidas este mes. "
                "El contador se reinicia el día 1."
            ),
        )
    elif used * 100 >= quota * 80:
        await try_send_operational_alert(
            event_key=f"ai-quota-warning:{period}",
            event_type="ai_quota_warning",
            subject="La cuota de IA llegó al 80 %",
            title="La cuota mensual de IA está por agotarse",
            message=f"El negocio usó {used} de {quota} generaciones incluidas este mes.",
        )


async def notify_ai_job_created() -> None:
    """Avisa justo cuando el job nuevo hace cruzar el umbral o agota la cuota."""

    context = get_current_tenant()
    if context is None:
        return
    entitlement = await get_entitlement(context.organization_id)
    await _notify_quota(entitlement, await count_usage_this_month())


async def ensure_ai_available(operation: str = "rag") -> None:
    """Corta antes de crear el job si el plan no incluye IA, si la plataforma
    no terminó de configurar el asistente o si se agotó la cuota.

    El conteo y el alta del job no son atómicos: dos pedidos simultáneos con
    una sola generación restante pueden pasar los dos. Se acepta ese desvío de
    una unidad a cambio de no serializar todas las generaciones del negocio.
    """

    context = get_current_tenant()
    if context is None:
        raise AIUnavailableError(
            "tenant_required", "El asistente IA requiere el contexto del negocio", 503
        )
    entitlement = await get_entitlement(context.organization_id)
    if not entitlement.enabled:
        raise AIUnavailableError(
            "ai_disabled",
            "El asistente IA no está incluido en el plan de este negocio. "
            "Pide al equipo de la plataforma que lo habilite.",
            403,
        )
    if not await platform_ready(operation):
        raise AIUnavailableError(
            "ai_not_configured",
            "El asistente IA todavía no está disponible: falta completar su "
            "configuración en la plataforma. Avisa al equipo de soporte.",
            503,
        )
    if entitlement.monthly_quota is not None:
        used = await count_usage_this_month()
        await _notify_quota(entitlement, used)
        if used >= entitlement.monthly_quota:
            used_up = (
                f"Tu negocio ya usó las {entitlement.monthly_quota} sugerencias de IA "
                "incluidas este mes."
                if entitlement.monthly_quota
                else "El plan de tu negocio no incluye sugerencias de IA este mes."
            )
            raise AIUnavailableError(
                "ai_quota_exceeded",
                f"{used_up} El contador se reinicia el día 1; para ampliarlo, "
                "contacta al equipo de la plataforma.",
                429,
            )
