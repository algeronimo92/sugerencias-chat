"""La visibilidad configurable contra SQL real, incluidos datos ya guardados."""

from types import SimpleNamespace

import pytest
from sqlalchemy import update

from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.conversations.chat_queries import LeadFilters, fetch_chats, search_chat_messages
from app.modules.conversations.inbox_queries import fetch_inbox_counts, fetch_total_unread_chat_count
from app.modules.leads.api import _lead_filters
from app.modules.leads.kanban_queries import fetch_kanban_counts, fetch_kanban_snapshot, fetch_kanban_stage
from app.modules.leads.visibility import ensure_lead_visible, seller_scope
from app.modules.leads.domain.errors import LeadNotFound
from app.modules.notifications.repository import create_system_notification
from app.modules.notifications.queries import list_notifications
from app.modules.notifications.types import NotificationType
from app.modules.auth.permissions import Permission
from app.modules.auth.roles_service import permissions_for_role, set_role_permission
from app.modules.auth.types import UserRole
from app.modules.tasks.repository import create_task, complete_pending_tasks
from app.modules.tasks.queries import list_tasks
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401
from tests.test_chat_inboxes_postgres import _lead, _seller
from datetime import datetime, timezone


async def _scope_sellers(scoped: bool) -> None:
    """Desde la matriz de permisos lo decide ``leads.view_all`` del vendedor;
    el interruptor de Configuración escribe exactamente esto."""
    await set_role_permission(UserRole.SELLER, Permission.LEADS_VIEW_ALL, granted=not scoped)


async def _as_seller(user_id: int) -> SimpleNamespace:
    # Como lo deja ``get_current_user``: con la fila vigente de la matriz.
    return SimpleNamespace(id=user_id, role=UserRole.SELLER, permissions=await permissions_for_role(UserRole.SELLER))


async def test_toggle_scopes_lists_search_counts_and_kanban_and_admins_keep_everything(tenant):
    with tenant_context(tenant):
        ana, bea = await _seller("Ana"), await _seller("Bea")
        own = await _lead("Ana cliente", seller_id=ana, last_from="cliente", read=False)
        await _lead("Bea cliente", seller_id=bea, last_from="cliente", read=False)
        await _lead("Libre cliente", last_from="cliente", read=False)
        admin = SimpleNamespace(id=1, role="admin")
        for scoped, expected in [(False, 3), (True, 1), (False, 3)]:
            await _scope_sellers(scoped)
            user = await _as_seller(ana)
            filters = await _lead_filters(user=user, tag_mode="any", seller_id=None, last_sender=None, inactive_days=None, waiting_time=None, conversation=None)
            owner = await seller_scope(user)
            assert len((await fetch_chats(filters=filters))["items"]) == expected
            assert len((await fetch_chats(search="cliente", filters=filters))["items"]) == expected
            assert len((await search_chat_messages("hola", filters=filters))["items"]) == expected
            counts = await fetch_inbox_counts(filters, ana)
            assert counts["all"] == counts["unread"] == expected
            assert await fetch_total_unread_chat_count(owner) == expected
            assert sum((await fetch_kanban_counts(owner_id=owner)).values()) == expected
            snapshot = await fetch_kanban_snapshot(owner_id=owner)
            assert sum(len(page["items"]) for page in snapshot["stages"].values()) == expected
            assert len((await fetch_kanban_stage("nuevo", owner_id=owner))["items"]) == expected
            assert await seller_scope(admin) is None
            assert len((await fetch_chats(filters=await _lead_filters(user=admin, tag_mode="any", seller_id=None, last_sender=None, inactive_days=None, waiting_time=None, conversation=None)))["items"]) == 3
        await _scope_sellers(True)
        user = await _as_seller(ana)
        # Elegir otra vendedora o "sin asignar" no puede ampliar la visibilidad.
        assert (await fetch_chats(filters=LeadFilters(owner_id=ana, seller_id=bea)))["items"] == []
        assert (await fetch_chats(filters=LeadFilters(owner_id=ana, unassigned=True)))["items"] == []
        # Reasignación: también invalida el acceso por URL que ya conocía.
        async with session_scope() as session:
            await session.execute(update(Lead).where(Lead.id == own).values(vendedor_id=bea))
        with pytest.raises(LeadNotFound):
            await ensure_lead_visible(user, own)


async def test_old_tasks_and_notifications_are_hidden_and_restore_when_disabled(tenant):
    with tenant_context(tenant):
        ana, bea = await _seller("Ana"), await _seller("Bea")
        own = await _lead("Propio", seller_id=ana)
        foreign = await _lead("Ajeno", seller_id=bea)
        for lead_id in (own, foreign):
            await create_system_notification(ana, NotificationType.INTERNAL_NOTE_MENTION, "Nota", "Privado", lead_id=lead_id)
            await create_task({"lead_id": lead_id, "title": "Llamar", "assigned_user_id": ana,
                               "due_at": datetime.now(timezone.utc)}, ana)
        await create_system_notification(ana, NotificationType.APPOINTMENT, "Aviso general", "Sin lead")
        assert (await list_notifications(ana))["unread_count"] == 3
        assert len(await list_tasks(ana, False, None, None)) == 2
        page = await list_notifications(ana, owner_id=ana, limit=1)
        assert page["unread_count"] == 2
        assert page["has_more"] is True
        assert all(item["lead_id"] != foreign for item in page["items"])
        assert [task["lead_id"] for task in await list_tasks(ana, False, None, None, owner_id=ana)] == [own]
        assert await complete_pending_tasks(ana, False, owner_id=ana) == 1
        remaining = await list_tasks(ana, False, "pending", None)
        assert [task["lead_id"] for task in remaining] == [foreign]
        assert len((await list_notifications(ana))["items"]) == 3


async def test_linked_contacts_and_appointments_follow_the_owner_and_new_leads_stay_visible(tenant):
    from datetime import date
    from app.db.models.appointments import Appointment
    from app.modules.appointments.infrastructure.repository import SqlAppointmentLeads
    from app.modules.appointments.queries import list_appointments
    from app.modules.contacts.queries import get_contact, list_contacts, list_tags
    from app.modules.contacts.repository import insert_contacts
    from app.modules.contacts.service import create_contact, promote_to_lead
    from app.modules.leads.queries import fetch_lead_sellers

    with tenant_context(tenant):
        ana, bea = await _seller("Ana"), await _seller("Bea")
        own, foreign = await _lead("Propio", seller_id=ana), await _lead("Ajeno", seller_id=bea)
        [contact_own, contact_foreign] = await insert_contacts([
            {"nombre": "Propio", "telefono": "51987000101", "lead_id": own, "etiquetas": ["propio"], "origen": "manual"},
            {"nombre": "Ajeno", "telefono": "51987000102", "lead_id": foreign, "etiquetas": ["privado"], "origen": "manual"},
        ])
        assert len((await list_contacts())["items"]) == 2
        assert (await list_contacts(owner_id=ana))["total"] == 1
        assert await get_contact(str(contact_foreign["id"]), owner_id=ana) is None
        assert await list_tags(owner_id=ana) == ["propio"]
        assert await list_tags() == ["privado", "propio"]
        for lead_id in (own, foreign, None):
            async with session_scope() as session:
                appointment = Appointment(created_by_user_id=ana, lead_id=lead_id, nombre_completo="Cita",
                    telefono="51987000103", tratamiento="Consulta", fecha=date.today(), hora="10:00", vendedor="Ana", status="created")
                session.add(appointment)
                await session.flush()
                appointment_id = appointment.id
            # Contrato histórico: la notificación no guardaba lead_id.
            await create_system_notification(ana, NotificationType.APPOINTMENT, "Cita", "Datos del cliente",
                metadata={"appointment_id": appointment_id})
        assert len(await list_appointments()) == 3
        assert (await list_notifications(ana, owner_id=ana))["unread_count"] == 2
        visible = await list_appointments(owner_id=ana)
        assert {item["lead_id"] for item in visible} == {own, None}
        # Con la visibilidad sin acotar el lead de la cita igual queda del responsable
        # que la cita nombra: sin vendedor fallaba la automatización de lead nuevo.
        for_bea = await SqlAppointmentLeads().create(
            phone="51987000106", name="De Bea", actor_user_id=ana, seller_name="Bea",
        )
        assert await fetch_lead_sellers([for_bea]) == {for_bea: bea}
        await _scope_sellers(True)
        new_from_appointment = await SqlAppointmentLeads().create(
            phone="51987000104", name="Nueva", actor_user_id=ana, seller_name="Nadie",
        )
        contact = await create_contact({"nombre": "Nuevo contacto", "telefono": "987000105"}, user_id=ana)
        new_from_contact = await promote_to_lead(contact["id"], user_id=ana)
        assert await fetch_lead_sellers([new_from_appointment, new_from_contact]) == {
            new_from_appointment: ana, new_from_contact: ana,
        }
        with pytest.raises(LeadNotFound):
            await promote_to_lead(str(contact_foreign["id"]), user_id=ana)
