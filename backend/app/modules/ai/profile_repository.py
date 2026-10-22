"""Persistence of the tenant AI profile; no normalization or provider calls."""
from datetime import datetime, timezone
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.db.models.ai import AIProfile
from app.db.uow import session_scope

def _profile_dict(row: AIProfile | None, fields: tuple[str, ...]) -> dict:
    values = {key: getattr(row, key) if row is not None else None for key in fields}
    updated_at = row.updated_at if row is not None else None
    return {
        **values,
        "updated_at": updated_at.isoformat().replace("+00:00", "Z") if updated_at else None,
    }

async def get_profile(fields: tuple[str, ...]) -> dict:
    async with session_scope() as session:
        row = await session.get(AIProfile, 1)
        return _profile_dict(row, fields)

async def save_profile(normalized: dict[str, str | None], user_id: int | None, fields: tuple[str, ...]) -> dict:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        statement = pg_insert(AIProfile).values(
            id=1, **normalized, updated_by=user_id, updated_at=now
        )
        statement = statement.on_conflict_do_update(
            index_elements=[AIProfile.id],
            set_={**normalized, "updated_by": user_id, "updated_at": now},
        )
        await session.execute(statement)
        await session.flush()
    return await get_profile(fields)
