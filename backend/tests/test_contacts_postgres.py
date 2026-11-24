"""La agenda de contactos contra PostgreSQL: importar un CSV eligiendo cuántos
(todos, un máximo o uno por uno) y el enlace con los leads."""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from uuid import uuid4

from app.db.models.auth import User
from app.db.uow import session_scope
from app.modules.contacts import import_service, service
from app.modules.contacts.queries import batch_rows, batch_summary, list_contacts
from app.modules.contacts.types import DuplicatePolicy, SelectionMode
from app.modules.leads.public import Actor, create_lead
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

async def _admin() -> int:
    async with session_scope() as session:
        user = User(
            email=f"admin-{uuid4().hex[:6]}@example.test", name="Admin", password_hash="!",
            role="admin", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


def _csv(*lines: str) -> bytes:
    return ("\n".join(lines) + "\n").encode("utf-8")


async def _csv_import(user_id: int, *lines: str) -> dict:
    content = _csv(*lines)
    preview = import_service.preview_csv(content)
    return await import_service.create_csv_import(
        content, file_name="lista.csv", mapping=preview["mapping"], user_id=user_id,
    )


async def _phones() -> set[str]:
    return {item["telefono"] for item in (await list_contacts(limit=200))["items"]}


async def test_csv_import_lets_you_choose_how_many_and_skips_the_rest(tenant):
    with tenant_context(tenant):
        admin = await _admin()
        summary = await _csv_import(
            admin,
            "nombre,telefono,etiquetas",
            "Ana,987000001,vip",
            "Beto,987000002,",
            "Ana repetida,987000001,",
            "Sin número,,",
            "Caro,987000003,",
        )
        assert summary["counts"]["pending"] == 3
        assert summary["counts"]["invalid"] == 1

        result = await import_service.confirm_import(
            summary["id"], import_service.Selection(limit=2, tags=["importado"]),
        )
        assert result == {"created": 2, "updated": 0, "skipped": 0}
        assert await _phones() == {"51987000001", "51987000002"}

        still_open = await batch_summary(summary["id"])
        assert still_open["status"] == "open"
        assert still_open["counts"]["pending"] == 1

        await import_service.discard_import(summary["id"])
        closed = await batch_summary(summary["id"])
        assert closed["status"] == "closed"
        assert closed["counts"]["discarded"] == 2  # Caro y la fila sin número

        ana = next(item for item in (await list_contacts(search="Ana"))["items"])
        assert ana["etiquetas"] == ["vip", "importado"]
        assert ana["origen"] == "csv"


async def test_manual_selection_and_filling_empty_fields_of_existing_contacts(tenant):
    with tenant_context(tenant):
        admin = await _admin()
        existing = await service.create_contact({"telefono": "987000010"}, user_id=admin)
        summary = await _csv_import(
            admin, "nombre,telefono,correo", "Dani,987000010,dani@example.test", "Eli,987000011,",
        )
        rows = (await batch_rows(summary["id"]))["items"]
        dani = next(row for row in rows if row["telefono"] == "51987000010")
        assert dani["exists"] is True

        result = await import_service.confirm_import(summary["id"], import_service.Selection(
            mode=SelectionMode.MANUAL, row_ids=[dani["id"]], duplicates=DuplicatePolicy.FILL_EMPTY, close=True,
        ))

        assert result == {"created": 0, "updated": 1, "skipped": 0}
        contact = next(item for item in (await list_contacts())["items"] if item["id"] == existing["id"])
        assert contact["email"] == "dani@example.test"
        # El nombre se escribió en el CRM (vacío, pero editado): no se toca.
        assert contact["nombre"] is None
        assert await _phones() == {"51987000010"}


async def test_contacts_follow_leads(tenant):
    with tenant_context(tenant):
        admin = await _admin()
        contact = await service.create_contact({"telefono": "987000050", "nombre": "Iris"}, user_id=admin)
        assert contact["lead_id"] is None

        lead_id = await service.promote_to_lead(contact["id"], user_id=admin)

        [linked] = (await list_contacts())["items"]
        assert linked["lead_id"] == lead_id

        # Un lead creado por otro lado también queda en la agenda.
        other = await create_lead("51987000051", "Juan", actor=Actor.user(admin))
        juan = next(item for item in (await list_contacts())["items"] if item["telefono"] == "51987000051")
        assert (juan["lead_id"], juan["origen"]) == (other, "lead")


async def test_initial_filter_folds_accents_and_keeps_n_tilde_apart(tenant):
    with tenant_context(tenant):
        admin = await _admin()
        for phone, name in [("987000061", "Ángela"), ("987000062", "ana"), ("987000063", "Ñique"),
                            ("987000064", "Nora"), ("987000065", "1er cliente"), ("987000066", None)]:
            await service.create_contact({"telefono": phone, "nombre": name}, user_id=admin)

        async def names(initial: str) -> set:
            return {item["nombre"] for item in (await list_contacts(initial=initial))["items"]}

        assert await names("A") == {"Ángela", "ana"}
        assert await names("n") == {"Nora"}
        assert await names("Ñ") == {"Ñique"}
        # Sin nombre (solo número) o con algo que no es letra: "#".
        assert await names("#") == {"1er cliente", None}
        assert (await list_contacts(initial="A", search="ang"))["total"] == 1


def test_csv_upload_round_trip_is_base64():
    # El frontend manda el archivo en base64, como el resto de las subidas.
    assert base64.b64decode(base64.b64encode(_csv("a,b", "1,2"))) == _csv("a,b", "1,2")
