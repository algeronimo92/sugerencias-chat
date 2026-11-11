"""El dashboard sin PostgreSQL: se compila su SQL y se afirma sobre el payload.

Sus consultas son puro SQL agregado, lo que las vuelve fáciles de romper sin
que ningún otro test se entere: una columna mal escrita o un `FILTER` mal
colocado solo explota al abrir el panel en producción. Acá cada statement se
compila contra el dialecto real de PostgreSQL y las filas las devuelve un doble
que inventa valores del tipo correcto según las columnas pedidas.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.modules.leads.dashboard import api as dashboard_router
from app.modules.leads.dashboard import queries as dashboard_service
from app.modules.leads.dashboard import (
    activity_queries as activity,
    appointments_queries as appointments,
    automations_queries as automations,
    hours_queries as hours,
    leads_queries as leads,
    summary_queries as summary,
    tags_queries as tags,
)
from app.modules.leads.dashboard import currency
from app.modules.leads.dashboard.scope import SCOPE_MINE, SCOPE_TEAM, build_scope


BLOCKS = (summary, leads, automations, tags, appointments, activity, hours)


def _sample_value(column):
    """Un valor del tipo que la columna declara.

    Devolver ceros para todo no alcanza: el código llama `.isoformat()` sobre
    las fechas que sirve al frontend, y un 0 ahí pasaría el test dejando pasar
    el error real. Los agregados como `avg(extract(...))` no llevan tipo
    declarado y `python_type` levanta; en este dashboard siempre son números.
    """
    try:
        python_type = column.type.python_type
    except NotImplementedError:
        return Decimal("120")

    if python_type is bool:
        return False
    if issubclass(python_type, datetime):
        return datetime(2026, 9, 15, 12, 30, tzinfo=timezone.utc)
    if issubclass(python_type, date):
        return date(2026, 9, 15)
    if issubclass(python_type, (int, float, Decimal)):
        return 1
    return "valor"


@pytest.fixture
def compiled_sql(monkeypatch):
    """Sustituye el acceso a la base en cada bloque y acumula el SQL generado."""
    statements: list[str] = []

    async def fake_execute_mapping(stmt):
        statements.append(str(stmt.compile(dialect=postgresql.dialect())))
        return [{name: _sample_value(column) for name, column in stmt.selected_columns.items()}]

    async def fake_currency():
        return "PEN"

    for block in BLOCKS:
        monkeypatch.setattr(block, "execute_mapping", fake_execute_mapping)
    # La moneda sale del perfil IA, que abriría una sesión real.
    monkeypatch.setattr(currency, "_profile_currency", fake_currency)
    return statements


@pytest.fixture(autouse=True)
def _no_cache():
    """La caché es un dict de módulo: sin limpiarla, el segundo test recibiría
    el payload del primero y no compilaría nada."""
    dashboard_service._cache.clear()
    yield
    dashboard_service._cache.clear()


@pytest.mark.parametrize("scope", [SCOPE_MINE, SCOPE_TEAM])
@pytest.mark.asyncio
async def test_every_query_compiles_against_postgres(compiled_sql, scope):
    await dashboard_service.get_dashboard_metrics(30, scope, user_id=7)

    # Un bloque que se olvidara de consultar pasaría inadvertido si solo se
    # contara "más de cero".
    assert len(compiled_sql) >= 25
    assert all("SELECT" in sql for sql in compiled_sql)


@pytest.mark.asyncio
async def test_payload_carries_every_panel(compiled_sql):
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)

    assert data["scope"] == SCOPE_MINE
    assert data["period_days"] == 30
    for key in ("summary", "stages", "origins", "services", "sellers", "new_leads_trend",
                "funnel", "pipeline", "automations", "tags", "appointments", "activity", "hours", "currency"):
        assert key in data, f"falta el bloque {key}"
    for key in ("total_leads", "new_leads", "awaiting_reply", "overdue_tasks", "completed_tasks",
                "avg_response_minutes", "appointments_created", "flows_started", "flows_active",
                "messages_sent", "tagged_leads"):
        assert key in data["summary"], f"falta el KPI {key}"
    for key in ("by_flow", "by_actor", "by_source", "by_trigger", "trend", "trend_manual",
                "trend_automatic", "failures", "active_now"):
        assert key in data["automations"], f"falta el panel de flujos {key}"
    for key in ("coverage", "top", "by_user", "trend"):
        assert key in data["tags"], f"falta el panel de etiquetas {key}"
    for key in ("by_status", "by_treatment", "by_treatment_daily", "by_user", "by_owner", "trend",
                "lost_reasons", "upcoming", "no_shows", "linkage", "separations"):
        assert key in data["appointments"], f"falta el panel de citas {key}"
    for key in ("trend", "by_type", "by_user", "messages"):
        assert key in data["activity"], f"falta el panel de actividad {key}"
    assert set(data["activity"]["messages"]["by_origin"][0]) == {"date", "app", "automation", "scheduled", "phone"}


@pytest.mark.asyncio
async def test_own_scope_filters_by_user_and_team_scope_does_not(compiled_sql):
    await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)
    mine = "\n".join(compiled_sql)
    compiled_sql.clear()
    await dashboard_service.get_dashboard_metrics(30, SCOPE_TEAM, user_id=7)
    team = "\n".join(compiled_sql)

    assert "leads.vendedor_id = " in mine
    assert "automation_executions.started_by_user_id = " in mine
    assert "appointments.created_by_user_id = " in mine
    assert "lead_activity.actor_user_id = " in mine
    assert "wsp_messages.sent_by_user_id = " in mine

    assert "leads.vendedor_id = " not in team
    assert "appointments.created_by_user_id = " not in team


@pytest.mark.asyncio
async def test_team_rankings_are_shared_in_both_scopes(compiled_sql):
    """La comparativa del equipo se sirve igual al vendedor: es lo que le deja
    ver cómo va respecto a los demás sin cambiar de scope."""
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)

    assert data["sellers"], "el ranking por vendedor no debe depender del scope"
    assert data["automations"]["by_actor"]
    assert data["tags"]["by_user"]
    assert data["appointments"]["by_user"]
    assert data["appointments"]["separations"]["by_seller"]
    assert data["appointments"]["separations"]["by_owner"]


@pytest.mark.asyncio
async def test_series_covers_every_day_of_the_period(compiled_sql):
    data = await dashboard_service.get_dashboard_metrics(7, SCOPE_MINE, user_id=7)

    for name, points in (
        ("leads", data["new_leads_trend"]),
        ("flujos", data["automations"]["trend"]),
        ("etiquetas", data["tags"]["trend"]),
        ("citas", data["appointments"]["trend"]),
        ("actividad", data["activity"]["trend"]),
        ("mensajes", data["activity"]["messages"]["trend"]),
        ("separaciones", data["appointments"]["separations"]["trend"]),
        ("separaciones del período anterior", data["appointments"]["separations"]["previous_trend"]),
    ):
        assert len(points) == 7, f"la serie de {name} debe traer un punto por día"
        assert [point["date"] for point in points] == sorted(point["date"] for point in points)


@pytest.mark.asyncio
async def test_cache_reuses_the_payload_per_scope_and_user(compiled_sql):
    await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)
    queries_after_first = len(compiled_sql)

    await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)
    assert len(compiled_sql) == queries_after_first, "el segundo pedido igual no debe consultar"

    # Otro vendedor no puede recibir las métricas del primero.
    await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=9)
    assert len(compiled_sql) > queries_after_first


@pytest.mark.asyncio
async def test_seller_defaults_to_own_scope_and_admin_to_the_team(monkeypatch):
    received = []

    async def fake_metrics(days, scope, user_id):
        received.append((days, scope, user_id))
        return {}

    monkeypatch.setattr(dashboard_router, "get_dashboard_metrics", fake_metrics)

    await dashboard_router.dashboard(days=30, scope=None, seller_id=None, user=SimpleNamespace(id=3, role="vendedor"))
    await dashboard_router.dashboard(days=30, scope=None, seller_id=None, user=SimpleNamespace(id=1, role="admin"))
    # Un vendedor sí puede pedir el total del equipo: ya ve todos los chats, así
    # que no es información nueva y le da contexto a sus propios números.
    await dashboard_router.dashboard(days=30, scope=SCOPE_TEAM, seller_id=None, user=SimpleNamespace(id=3, role="vendedor"))

    assert received == [(30, SCOPE_MINE, 3), (30, SCOPE_TEAM, 1), (30, SCOPE_TEAM, 3)]


@pytest.mark.asyncio
async def test_own_response_time_counts_only_replies_written_by_the_user(compiled_sql):
    """En un chat que atienden dos personas, la respuesta del otro no mide el
    tiempo de nadie: el promedio propio filtra por autor del mensaje."""
    await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)
    avg_queries = [sql for sql in compiled_sql if "avg(" in sql and "epoch" in sql]

    assert avg_queries, "no se generó la consulta del tiempo de respuesta"
    assert any("sent_by_user_id = " in sql for sql in avg_queries)


@pytest.mark.asyncio
async def test_appointments_report_how_many_reached_a_lead(compiled_sql):
    """Una tasa baja de vinculación avisa que los teléfonos del formulario no
    están coincidiendo con las fichas del CRM."""
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)

    linkage = data["appointments"]["linkage"]
    assert set(linkage) == {"total", "linked", "unlinked", "rate"}
    assert linkage["unlinked"] == linkage["total"] - linkage["linked"]
    # Las citas próximas salen de appointments, así que traen su propio id y el
    # lead solo cuando se pudo resolver.
    assert all({"id", "lead_id", "name", "date", "time"} <= set(row) for row in data["appointments"]["upcoming"])


def test_funnel_rates_are_relative_to_the_cohort():
    """La tasa se mide contra los leads creados en el período, no contra el paso
    anterior: así "Cliente 12%" se lee directo sin multiplicar los pasos."""
    scope = build_scope(30, SCOPE_MINE, user_id=7)
    assert scope.days == 30
    assert scope.start <= scope.now
    assert scope.is_mine


@pytest.mark.asyncio
async def test_currency_only_passes_iso_codes(monkeypatch):
    """El perfil acepta texto libre; el navegador solo formatea códigos ISO."""
    for stored, expected in (("PEN", "PEN"), ("S/", None), ("SOLES", None), (None, None)):
        async def fake(value=stored):
            return value
        monkeypatch.setattr(currency, "_profile_currency", fake)
        assert await currency.business_currency() == expected


@pytest.mark.asyncio
async def test_payload_carries_the_business_currency(compiled_sql):
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_TEAM, user_id=7)
    assert data["currency"] == "PEN"
    # Las versiones anteriores de la app leen el bloque de ventas: va vacío y
    # completo, o su dashboard se rompe hasta que se actualizan.
    legacy = data["sales"]
    assert legacy["currency"] == "PEN"
    assert legacy["totals"]["count"] == 0 and legacy["previous"] is None
    for key in ("trend", "previous_trend", "by_package", "by_service", "by_service_daily", "by_seller", "recent"):
        assert legacy[key] == [], key



@pytest.mark.asyncio
async def test_booked_appointments_by_treatment_skip_duplicates_and_tests(compiled_sql):
    """Solo cuentan las citas agendadas de verdad, del período y del scope, con
    las variantes de escritura del tratamiento juntas."""
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)

    daily_sql = [sql for sql in compiled_sql if "regexp_replace(appointments.tratamiento" in sql]
    assert len(daily_sql) == 1
    sql = daily_sql[0]
    assert "appointments.status IN" in sql and "appointments.test_mode IS false" in sql
    assert "appointments.created_by_user_id = " in sql
    assert "mode() WITHIN GROUP (ORDER BY appointments.tratamiento)" in sql
    assert set(data["appointments"]["by_treatment_daily"][0]) == {"date", "key", "name", "count", "amount"}


@pytest.mark.asyncio
async def test_separations_read_the_deposit_from_either_field_and_compare_windows(compiled_sql):
    """La venta es la separación de cita: el monto sale del adelanto fijo o del
    campo personalizado, y la comparación usa la ventana anterior sin solaparse."""
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)

    separations = data["appointments"]["separations"]
    for key in ("totals", "previous", "trend", "previous_trend", "by_seller", "by_owner", "recent"):
        assert key in separations, f"falta {key} en separaciones"
    assert len(separations["trend"]) == len(separations["previous_trend"]) == 30

    deposit_sql = [sql for sql in compiled_sql if "jsonb_typeof(appointments.custom_fields" in sql]
    assert deposit_sql, "el monto debe leer el campo personalizado adelanto"
    assert any("appointments.created_at < " in sql for sql in deposit_sql), "falta el tope de la ventana anterior"
    # Los dos rankings del equipo (quién registró, de quién es el lead) no se acotan.
    scoped = [sql for sql in deposit_sql if "GROUP BY coalesce(users.name" not in sql and "users AS users_1" not in sql]
    assert all("appointments.created_by_user_id = " in sql for sql in scoped)


@pytest.mark.asyncio
async def test_admin_can_open_a_sellers_dashboard_and_a_seller_only_their_own(monkeypatch):
    """Filtrar por vendedora es mirar "lo suyo" de otra persona: el admin
    puede, un vendedor no (ya ve los rankings del equipo)."""
    received = []

    async def fake_metrics(days, scope, user_id):
        received.append((days, scope, user_id))
        return {}

    monkeypatch.setattr(dashboard_router, "get_dashboard_metrics", fake_metrics)

    await dashboard_router.dashboard(days=7, scope=None, seller_id=5, user=SimpleNamespace(id=1, role="admin"))
    await dashboard_router.dashboard(days=7, scope=SCOPE_TEAM, seller_id=3, user=SimpleNamespace(id=3, role="vendedor"))
    assert received == [(7, SCOPE_MINE, 5), (7, SCOPE_MINE, 3)]

    with pytest.raises(HTTPException) as exc:
        await dashboard_router.dashboard(days=7, scope=None, seller_id=5, user=SimpleNamespace(id=3, role="vendedor"))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_flow_trend_splits_into_manual_and_automatic_that_add_up(compiled_sql):
    data = await dashboard_service.get_dashboard_metrics(7, SCOPE_TEAM, user_id=7)
    flows = data["automations"]

    assert len(flows["trend_manual"]) == len(flows["trend_automatic"]) == 7
    for total, manual, automatic in zip(flows["trend"], flows["trend_manual"], flows["trend_automatic"]):
        assert manual["value"] + automatic["value"] == total["value"]


@pytest.mark.asyncio
async def test_hours_count_by_weekday_and_slot_with_what_the_average_needs(compiled_sql):
    data = await dashboard_service.get_dashboard_metrics(30, SCOPE_TEAM, user_id=7)
    hours = data["hours"]

    # Sin esto, un período con cinco lunes haría ver al lunes más cargado.
    assert sum(hours["weekday_occurrences"]) == 30
    assert len(hours["weekday_occurrences"]) == 7
    assert hours["slot_hours"] == 2 and hours["engagement_window_hours"] == 24
    # Conversaciones, flujos y mensajes caen en la misma celda y se funden en una fila.
    assert hours["cells"] == [{
        "weekday": 0, "slot": 1, "conversations": 1, "settled": 1, "engaged": 1,
        "flows_manual": 1, "flows_automatic": 1, "messages": 1,
    }]


@pytest.mark.asyncio
async def test_engagement_counts_turns_after_our_first_reply_within_the_window(compiled_sql):
    """Tres mensajes seguidos del cliente antes de que nadie conteste no son
    avance: cuenta que escriba de nuevo después de nuestra respuesta."""
    await dashboard_service.get_dashboard_metrics(30, SCOPE_TEAM, user_id=7)
    sql = next(statement for statement in compiled_sql if "AS engaged" in statement and "isodow" in statement)

    assert "sender != " in sql and "min(" in sql
    assert "EXISTS" in sql
    assert "leads.created_at + " in sql
    assert "America/Lima" not in sql or "timezone(" in sql


@pytest.mark.asyncio
async def test_hours_follow_the_scope(compiled_sql):
    await dashboard_service.get_dashboard_metrics(30, SCOPE_MINE, user_id=7)
    by_hour = [statement for statement in compiled_sql if "isodow" in statement]

    assert len(by_hour) == 3
    assert any("leads.vendedor_id = " in statement for statement in by_hour)
    assert any("automation_executions.started_by_user_id = " in statement for statement in by_hour)
    # Los mensajes van por quien los escribió, no por de quién es el chat: lo
    # que una vendedora escribe en el chat de otra es trabajo suyo.
    assert any("wsp_messages.sent_by_user_id = " in statement for statement in by_hour)
