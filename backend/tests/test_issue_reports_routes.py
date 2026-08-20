import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from domain_types import IssueReportStatus
from models.schemas import IssueReportCreate, IssueReportUpdate
from routers import issue_reports


def report_item(**overrides):
    defaults = {
        "id": 7,
        "public_code": "REP-000007",
        "reporter_user_id": 11,
        "reporter_name": "Vendedora",
        "title": "No puedo enviar mensajes",
        "description": "El botón permanece cargando y no envía.",
        "status": "new",
        "current_path": "/chat/9cc06f7e-105f-45a6-8bc8-88223051355e",
        "lead_id": "9cc06f7e-105f-45a6-8bc8-88223051355e",
        "technical_context": {},
        "attachments": [],
        "resolved_at": None,
        "resolved_by_name": None,
        "created_at": "2026-08-20T10:00:00Z",
        "updated_at": "2026-08-20T10:00:00Z",
    }
    return {**defaults, **overrides}


@pytest.mark.asyncio
async def test_seller_lists_only_their_reports(monkeypatch):
    received = None

    async def fake_list(user_id, is_admin, status):
        nonlocal received
        received = (user_id, is_admin, status)
        return []

    monkeypatch.setattr(issue_reports, "list_issue_reports", fake_list)
    await issue_reports.get_reports(IssueReportStatus.NEW, SimpleNamespace(id=11, role="vendedor"))

    assert received == (11, False, IssueReportStatus.NEW)


@pytest.mark.asyncio
async def test_seller_cannot_change_status():
    with pytest.raises(HTTPException) as exc:
        await issue_reports.patch_report(
            7,
            IssueReportUpdate(status=IssueReportStatus.RESOLVED),
            SimpleNamespace(id=11, role="vendedor"),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_seller_cannot_view_another_users_report(monkeypatch):
    async def fake_get(_report_id):
        return report_item(reporter_user_id=99)

    monkeypatch.setattr(issue_reports, "get_issue_report", fake_get)
    with pytest.raises(HTTPException) as exc:
        await issue_reports.get_report(7, SimpleNamespace(id=11, role="vendedor"))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_report_accepts_image_and_persists_metadata(monkeypatch):
    saved = []
    created = None

    def fake_save(content_type, data_base64, filename):
        saved.append((content_type, data_base64, filename))
        return "/media/evidence.png"

    async def fake_create(values, attachments, reporter_id):
        nonlocal created
        created = (values, attachments, reporter_id)
        return report_item(attachments=[{"id": 1, **attachments[0]}])

    async def no_admins():
        return []

    async def no_broadcast(_payload):
        return None

    monkeypatch.setattr(issue_reports, "save_media_file", fake_save)
    monkeypatch.setattr(issue_reports, "create_issue_report", fake_create)
    monkeypatch.setattr(issue_reports, "list_active_admin_ids", no_admins)
    monkeypatch.setattr(issue_reports.manager, "broadcast", no_broadcast)

    encoded = base64.b64encode(b"fake-png").decode("ascii")
    body = IssueReportCreate(
        title="  No puedo enviar mensajes  ",
        description="  El botón permanece cargando y no envía.  ",
        current_path="/tasks",
        technical_context={"viewport_width": 390},
        attachments=[{
            "content_type": "image/png",
            "data_base64": encoded,
            "filename": "captura.png",
        }],
    )
    result = await issue_reports.post_report(body, SimpleNamespace(id=11, role="vendedor", name="Vendedora"))

    assert result["public_code"] == "REP-000007"
    assert saved == [("image/png", encoded, "captura.png")]
    assert created[0]["title"] == "No puedo enviar mensajes"
    assert created[1][0]["size_bytes"] == len(b"fake-png")
    assert created[2] == 11


@pytest.mark.asyncio
async def test_report_rejects_non_image_without_saving(monkeypatch):
    called = False

    def fake_save(*_args):
        nonlocal called
        called = True

    monkeypatch.setattr(issue_reports, "save_media_file", fake_save)
    body = IssueReportCreate(
        title="Archivo inválido",
        description="Intento adjuntar un archivo que no es imagen.",
        attachments=[{
            "content_type": "application/pdf",
            "data_base64": base64.b64encode(b"pdf").decode("ascii"),
            "filename": "evidencia.pdf",
        }],
    )

    with pytest.raises(HTTPException) as exc:
        await issue_reports.post_report(body, SimpleNamespace(id=11, role="vendedor", name="Vendedora"))
    assert exc.value.status_code == 400
    assert called is False
