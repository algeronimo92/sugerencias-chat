"""Cobertura de etiquetado: cuántos leads están etiquetados, con qué, y quién
las puso.

La cobertura se mide sobre los leads del scope (`vendedor_id`), mientras que
"quién etiquetó" sale de `lead_tag_assignments.assigned_by` — son dos preguntas
distintas y un lead ajeno puede haber sido etiquetado por uno mismo.
"""

import asyncio

from sqlalchemy import func, select

from db.models import Lead, LeadTag, LeadTagAssignment, User

from .context import DashboardScope, execute_mapping, items, local_day, series


async def _coverage(scope: DashboardScope) -> dict:
    tagged = (
        select(LeadTagAssignment.lead_id)
        .where(LeadTagAssignment.lead_id == Lead.id)
        .correlate(Lead)
        .exists()
    )
    rows = await execute_mapping(
        select(
            func.count(Lead.id).label("total"),
            func.count(Lead.id).filter(tagged).label("tagged"),
        ).where(scope.mine(Lead.vendedor_id))
    )
    row = rows[0]
    total = int(row["total"] or 0)
    tagged_count = int(row["tagged"] or 0)
    return {
        "total": total,
        "tagged": tagged_count,
        "untagged": total - tagged_count,
        "rate": round(tagged_count / total * 100, 1) if total else None,
    }


async def _top_tags(scope: DashboardScope) -> list[dict]:
    """El color viene del catálogo para que la barra se pinte igual que la
    píldora de la etiqueta en el chat."""
    rows = await execute_mapping(
        select(
            LeadTag.id.label("id"),
            LeadTag.name.label("name"),
            LeadTag.color.label("color"),
            func.count(LeadTagAssignment.lead_id).label("value"),
        )
        .join(LeadTagAssignment, LeadTagAssignment.tag_id == LeadTag.id)
        .join(Lead, Lead.id == LeadTagAssignment.lead_id)
        .where(scope.mine(Lead.vendedor_id))
        .group_by(LeadTag.id, LeadTag.name, LeadTag.color)
        .order_by(func.count(LeadTagAssignment.lead_id).desc())
        .limit(10)
    )
    return [
        {
            "id": int(row["id"]),
            "name": str(row["name"]),
            "color": str(row["color"]),
            "value": int(row["value"]),
        }
        for row in rows
    ]


async def collect(scope: DashboardScope) -> dict:
    assigner = func.coalesce(User.name, "Automatización")
    # Ranking del equipo, sin acotar al scope: igual que los demás rankings.
    by_user_stmt = (
        select(assigner.label("name"), func.count(LeadTagAssignment.lead_id).label("value"))
        .outerjoin(User, User.id == LeadTagAssignment.assigned_by)
        .where(LeadTagAssignment.assigned_at >= scope.start)
        .group_by(assigner)
        .order_by(func.count(LeadTagAssignment.lead_id).desc())
        .limit(12)
    )
    day = local_day(LeadTagAssignment.assigned_at)
    trend_stmt = (
        select(day.label("day"), func.count(LeadTagAssignment.lead_id).label("total"))
        .where(
            LeadTagAssignment.assigned_at >= scope.start,
            scope.mine(LeadTagAssignment.assigned_by),
        )
        .group_by(day)
        .order_by(day)
    )

    coverage, top, by_user, trend = await asyncio.gather(
        _coverage(scope),
        _top_tags(scope),
        execute_mapping(by_user_stmt),
        execute_mapping(trend_stmt),
    )
    return {
        "coverage": coverage,
        "top": top,
        "by_user": items(by_user),
        "trend": series(trend, scope),
    }
