"""La bandeja paginada de "Tareas" contra SQL real: con más pendientes que una
página no se pierde ninguna, y los contadores cuentan todas, no solo las que
llegaron (antes la lista se cortaba en 500)."""

from datetime import datetime, timedelta, timezone

from app.modules.tasks.queries import list_pending_page
from app.modules.tasks.repository import create_task, update_task
from app.modules.tasks.types import TaskType
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401
from tests.test_chat_inboxes_postgres import _lead, _seller


async def test_pages_cover_every_pending_task_and_counts_follow_search(tenant):
    with tenant_context(tenant):
        ana, bea = await _seller("Ana"), await _seller("Bea")
        lead = await _lead("Lucía 50%", seller_id=ana)
        now = datetime.now(timezone.utc)
        day_end = now + timedelta(hours=6)
        for index in range(3):
            await create_task({"lead_id": lead, "title": f"Vencida {index}", "assigned_user_id": ana,
                               "due_at": now - timedelta(hours=index + 1)}, ana)
        for index in range(2):
            await create_task({"lead_id": lead, "title": f"Hoy {index}", "assigned_user_id": ana, "task_type": TaskType.CALL,
                               "due_at": now + timedelta(hours=index + 1)}, ana)
        for index in range(20):
            await create_task({"lead_id": lead, "title": f"Próxima {index}", "assigned_user_id": ana,
                               "due_at": now + timedelta(days=index + 1)}, ana)
        await create_task({"lead_id": lead, "title": "De Bea", "assigned_user_id": bea, "due_at": now}, ana)

        seen = []
        for offset in range(0, 30, 10):
            page = await list_pending_page(ana, False, day_end=day_end, offset=offset, limit=10)
            seen += [item["title"] for item in page["items"]]
        assert page["total"] == page["pending_total"] == 25
        assert page["counts"] == {"all": 25, "overdue": 3, "today": 2, "upcoming": 20}
        assert len(seen) == len(set(seen)) == 25
        assert seen[:3] == ["Vencida 2", "Vencida 1", "Vencida 0"]

        upcoming = await list_pending_page(ana, False, day_end=day_end, bucket="upcoming", offset=10, limit=10)
        assert upcoming["total"] == 20 and len(upcoming["items"]) == 10

        # La búsqueda cubre el nombre del tipo, y los comodines de LIKE son texto.
        calls = await list_pending_page(ana, False, day_end=day_end, search="llamada")
        assert calls["counts"]["all"] == 2 and calls["pending_total"] == 25
        assert (await list_pending_page(ana, False, day_end=day_end, search="%"))["total"] == 25
        assert (await list_pending_page(ana, False, day_end=day_end, search="0%"))["total"] == 25
        assert (await list_pending_page(ana, False, day_end=day_end, search="_x"))["total"] == 0

        team = await list_pending_page(ana, True, day_end=day_end, all_users=True)
        assert team["pending_total"] == 26


async def test_status_filter_lists_closed_tasks_and_keeps_pending_counts(tenant):
    with tenant_context(tenant):
        ana = await _seller("Ana")
        lead = await _lead("Lead", seller_id=ana)
        now = datetime.now(timezone.utc)
        ids = []
        for index in range(5):
            task = await create_task({"lead_id": lead, "title": f"T{index}", "assigned_user_id": ana,
                                      "due_at": now + timedelta(days=index + 1)}, ana)
            ids.append(task["id"])
        await update_task(ids[0], {"status": "completed"}, ana)
        await update_task(ids[1], {"status": "completed"}, ana)
        await update_task(ids[2], {"status": "canceled"}, ana)
        day_end = now + timedelta(hours=6)

        pending = await list_pending_page(ana, False, day_end=day_end)
        assert [item["title"] for item in pending["items"]] == ["T3", "T4"]

        completed = await list_pending_page(ana, False, day_end=day_end, status="completed", bucket="upcoming")
        assert completed["total"] == 2
        assert {item["title"] for item in completed["items"]} == {"T0", "T1"}
        assert all(item["completed_at"] for item in completed["items"])
        # Los chips y "Completar todas" siguen hablando de las pendientes.
        assert completed["counts"]["all"] == completed["pending_total"] == 2

        everything = await list_pending_page(ana, False, day_end=day_end, status="all", limit=3)
        assert everything["total"] == 5
        assert [item["title"] for item in everything["items"]][:2] == ["T3", "T4"]
