"""Borrar un lead se lleva sus clics de anuncio (``wsp_ad``), contra PostgreSQL real.

La política de datos promete que al borrar un lead se eliminan sus datos,
incluido el identificador del clic del anuncio de Meta. La FK era SET NULL y
la fila quedaba entera, con teléfono, nombre, email y ``ctwaclid``. Solo una
base real lo prueba: el borrado lo hacen la FK y un DELETE por teléfono.
"""

from __future__ import annotations

from sqlalchemy import insert, select

from app.db.models.leads import WhatsappAdConversion
from app.db.uow import session_scope
from app.modules.leads.application.commands import create_lead, delete_lead, merge_leads
from app.modules.leads.domain.lead import Actor
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

SYSTEM = Actor.system()
PHONE = "51999000111"
OTHER_PHONE = "51999000222"


async def _ad_click(telefono: str, ctwaclid: str, lead_id: str | None = None) -> None:
    """Como la deja el subworkflow de n8n: con los datos del contacto."""
    async with session_scope() as session:
        await session.execute(insert(WhatsappAdConversion).values(
            lead_id=lead_id, telefono=telefono, ctwaclid=ctwaclid,
            nombre="Ana", apellido="Pérez", email="ana@example.test", item_nombre="Depilación láser",
        ))


async def _remaining() -> dict[str, str | None]:
    """``ctwaclid`` -> ``lead_id`` de lo que queda en la tabla."""
    async with session_scope() as session:
        rows = await session.execute(select(WhatsappAdConversion.ctwaclid, WhatsappAdConversion.lead_id))
        return {ctwaclid: lead_id for ctwaclid, lead_id in rows}


async def test_deleting_a_lead_removes_its_ad_clicks(tenant) -> None:
    with tenant_context(tenant):
        lead_id = await create_lead(PHONE, "Ana", actor=SYSTEM)
        await _ad_click(PHONE, "clic-del-lead", lead_id)

        await delete_lead(lead_id, actor=SYSTEM)

        assert await _remaining() == {}


async def test_deleting_a_lead_removes_the_clicks_saved_before_it_existed(tenant) -> None:
    """n8n guarda el clic con ``lead_id`` NULL si el lead todavía no existía:
    a esa fila solo la une el teléfono, y la FK no la alcanza."""
    with tenant_context(tenant):
        lead_id = await create_lead(PHONE, "Ana", actor=SYSTEM)
        other_id = await create_lead(OTHER_PHONE, "Beto", actor=SYSTEM)
        await _ad_click(PHONE, "sin-lead")
        await _ad_click("+51 999 000 111", "sin-lead-con-formato")
        await _ad_click(OTHER_PHONE, "de-otro-lead", other_id)
        await _ad_click(OTHER_PHONE, "sin-lead-de-otro-telefono")

        await delete_lead(lead_id, actor=SYSTEM)

        assert await _remaining() == {"de-otro-lead": other_id, "sin-lead-de-otro-telefono": None}


async def test_merging_leads_keeps_the_ad_clicks_on_the_surviving_lead(tenant) -> None:
    """La fusión termina borrando el lead de origen: con la FK en CASCADE, sus
    clics se irían con él si no se movieran antes al destino."""
    with tenant_context(tenant):
        source_id = await create_lead(PHONE, "Ana", actor=SYSTEM)
        target_id = await create_lead(OTHER_PHONE, "Ana P.", actor=SYSTEM)
        await _ad_click(PHONE, "clic-del-origen", source_id)

        await merge_leads(source_id, target_id, actor=SYSTEM)

        assert await _remaining() == {"clic-del-origen": target_id}
