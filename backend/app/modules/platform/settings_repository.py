"""Atomic persistence of tenant settings; encryption and cache policy stay in the service."""
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.db.models.settings import AppSetting
from app.db.session import get_sessionmaker


async def read_values() -> dict[str, str | None]:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(select(AppSetting.key, AppSetting.value))).all()
    return {key: value for key, value in rows}


async def upsert_values(values: dict[str, str | None]) -> None:
    async with get_sessionmaker()() as session:
        for key, value in values.items():
            statement = pg_insert(AppSetting).values(key=key, value=value).on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": value})
            await session.execute(statement)
        await session.commit()


async def update_values(values: dict[str, str]) -> None:
    async with get_sessionmaker()() as session:
        for key, value in values.items():
            await session.execute(update(AppSetting).where(AppSetting.key == key).values(value=value))
        await session.commit()
