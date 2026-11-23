"""Cupo de Meta para cambiar una plantilla aprobada: uno cada 24 h, diez cada 30 días."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.integrations.meta.client import MetaApiError
from app.modules.catalogs import templates_api as templates
from app.modules.catalogs.schemas import TemplateUpdate
from app.modules.catalogs.template_edit_quota import edits_in_window, next_edit_at, record_edit
from app.modules.catalogs.template_policies import _template

NOW = datetime(2026, 11, 23, 18, 17, tzinfo=timezone.utc)


def _ago(**delta) -> str:
    return (NOW - timedelta(**delta)).isoformat()


def test_sin_cambios_previos_se_puede_editar_ya():
    assert next_edit_at([], NOW) is None
    assert next_edit_at(None, NOW) is None


def test_tras_un_cambio_hay_que_esperar_24_horas():
    # El caso real: «Desde Instagram» se editó 13:12 y se reintentó 13:17.
    assert next_edit_at([_ago(minutes=5)], NOW) == NOW + timedelta(hours=23, minutes=55)
    assert next_edit_at([_ago(hours=24, minutes=1)], NOW) is None


def test_el_decimo_cambio_en_30_dias_bloquea_hasta_que_el_primero_vence():
    times = [_ago(days=29 - index * 2) for index in range(10)]  # el último, hace 11 días
    assert next_edit_at(times, NOW) == NOW + timedelta(days=1)
    assert next_edit_at(times[1:], NOW) is None


def test_los_cambios_viejos_o_ilegibles_no_cuentan():
    times = [_ago(days=31), "no-es-fecha", 42, _ago(days=2)]
    assert [moment.isoformat() for moment in edits_in_window(times, NOW)] == [_ago(days=2)]
    assert record_edit(times, NOW) == [_ago(days=2), NOW.isoformat()]


def _row(**overrides):
    row = {key: None for key in (
        "id", "name", "content", "shortcut", "category", "stage", "task_type", "service", "is_active", "visibility",
        "is_favorite", "template_type", "official_name", "official_language", "official_category", "official_status",
        "official_rejected_reason", "official_parameter_values", "meta_template_id", "official_header_type",
        "official_header_text", "official_header_media_asset_id", "official_header_media_url",
        "official_header_media_content_type", "official_header_media_filename", "official_footer", "official_buttons",
        "official_edit_times", "interactive_type", "interactive_config", "imported_from_meta", "last_used_at",
        "use_count", "created_by_user_id", "created_by_name", "created_at",
    )}
    row.update(overrides)
    return row


def test_la_api_informa_el_proximo_cambio_solo_si_esta_aprobada():
    recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    approved = _template(_row(official_status="APPROVED", official_edit_times=[recent]))
    assert approved["official_last_edit_at"] is not None
    assert approved["official_next_edit_at"] is not None

    # Una rechazada se corrige las veces que haga falta.
    rejected = _template(_row(official_status="REJECTED", official_edit_times=[recent]))
    assert rejected["official_next_edit_at"] is None

    assert _template(_row(official_status="APPROVED", official_edit_times=[]))["official_next_edit_at"] is None


def _current(**overrides):
    current = {
        "id": 21, "name": "Desde Instagram", "content": "Hola {{1}}, gracias por escribirnos.", "category": "ventas",
        "template_type": "official", "official_name": "desde_instagram", "official_language": "es",
        "official_category": "MARKETING", "official_status": "APPROVED", "official_rejected_reason": None,
        "official_parameter_values": ["{{nombre}}"], "meta_template_id": "meta-21", "official_edit_times": [],
        "official_header_type": "none", "official_header_text": None, "official_header_media_asset_id": None,
        "official_footer": None, "official_buttons": [], "interactive_type": "none", "interactive_config": {},
        "attachments": [], "stage": None, "task_type": None, "service": None, "shortcut": None,
    }
    current.update(overrides)
    return current


@pytest.fixture
def patched(monkeypatch):
    """`patch_template` con Meta y la base reemplazados; devuelve lo que recibieron."""
    calls = SimpleNamespace(current=_current(), sent=[], saved=[], meta_error=None)

    async def fake_list_templates(_user_id, _include_inactive):
        return [calls.current]

    async def fake_update_whatsapp_template(meta_id, components, category):
        if calls.meta_error:
            raise calls.meta_error
        calls.sent.append((meta_id, components, category))
        return {"success": True}

    async def fake_update_template(_template_id, values):
        calls.saved.append(values)
        return {**calls.current, **values}

    async def category_found(name):
        return {"id": 1, "name": name, "is_active": True}

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "update_whatsapp_template", fake_update_whatsapp_template)
    monkeypatch.setattr(templates, "update_template", fake_update_template)
    monkeypatch.setattr(templates, "get_template_category_by_name", category_found)
    return calls


ADMIN = SimpleNamespace(id=11, role="admin")


@pytest.mark.asyncio
async def test_el_primer_cambio_de_una_aprobada_se_envia_y_queda_registrado(patched):
    await templates.patch_template(21, TemplateUpdate(content="Hola {{1}}, te escribimos de la clínica."), ADMIN)

    assert len(patched.sent) == 1
    [saved] = patched.saved
    assert saved["official_status"] == "PENDING"
    assert len(saved["official_edit_times"]) == 1


@pytest.mark.asyncio
async def test_un_segundo_cambio_antes_de_24_horas_se_frena_sin_llamar_a_meta(patched):
    patched.current = _current(official_edit_times=[(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()])

    with pytest.raises(HTTPException) as raised:
        await templates.patch_template(21, TemplateUpdate(content="Hola {{1}}, otro texto distinto."), ADMIN)

    assert raised.value.status_code == 409
    assert "cada 24 horas" in raised.value.detail
    assert patched.sent == []
    assert patched.saved == []


@pytest.mark.asyncio
async def test_con_el_cupo_gastado_igual_se_guarda_lo_que_no_pasa_por_meta(patched):
    patched.current = _current(official_edit_times=[(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()])

    await templates.patch_template(21, TemplateUpdate(name="Desde Instagram (nuevo)"), ADMIN)

    assert patched.sent == []
    [saved] = patched.saved
    assert saved["name"] == "Desde Instagram (nuevo)"
    assert "official_edit_times" not in saved


@pytest.mark.asyncio
async def test_una_rechazada_no_tiene_cupo_ni_lo_gasta(patched):
    patched.current = _current(
        official_status="REJECTED",
        official_edit_times=[(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()],
    )

    await templates.patch_template(21, TemplateUpdate(content="Hola {{1}}, texto corregido."), ADMIN)

    assert len(patched.sent) == 1
    assert "official_edit_times" not in patched.saved[0]


@pytest.mark.asyncio
async def test_si_meta_rechaza_el_cambio_el_error_explica_el_cupo_y_queda_registrado(patched, monkeypatch):
    # El cupo también se gasta desde WhatsApp Manager, que la app no ve.
    patched.meta_error = MetaApiError(
        "rechazo", error={"code": 100, "error_subcode": 2388025, "message": "Template can't be edited"}, status_code=400,
    )

    # Se mira lo que el módulo manda a registrar, no `caplog`: en la suite
    # completa la app ya configuró el registro y `caplog` llegaba vacío.
    logged: list[str] = []
    monkeypatch.setattr(templates.logger, "warning", lambda message, *args: logged.append(message % args))

    with pytest.raises(HTTPException) as raised:
        await templates.patch_template(21, TemplateUpdate(content="Hola {{1}}, otro texto distinto."), ADMIN)

    assert raised.value.status_code == 502
    assert "Template can't be edited" in raised.value.detail
    assert "cada 24 horas" in raised.value.detail
    assert patched.saved == []
    [line] = logged
    assert "plantilla 21" in line
    assert "2388025" in line
