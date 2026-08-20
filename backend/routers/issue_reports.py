import asyncio
import base64
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError

from db.models import User
from domain_types import IssueReportStatus, NotificationType
from models.schemas import IssueReportCreate, IssueReportItem, IssueReportUpdate
from routers.media import normalize_media_content_type, save_media_file
from services.auth_service import get_current_user
from services.issue_report_service import (
    create_issue_report,
    get_issue_report,
    list_active_admin_ids,
    list_issue_reports,
    update_issue_report_status,
)
from services.media_storage import MediaStorageError, delete_media
from services.notification_service import create_system_notification
from services.ws_manager import manager


router = APIRouter(prefix="/api/issue-reports", tags=["issue-reports"])
MAX_EVIDENCE_BYTES = 5 * 1024 * 1024
logger = logging.getLogger(__name__)


async def _delete_saved(urls: list[str]) -> None:
    for media_url in urls:
        try:
            await asyncio.to_thread(delete_media, media_url)
        except MediaStorageError:
            pass


@router.get("", response_model=list[IssueReportItem])
async def get_reports(
    status: IssueReportStatus | None = None,
    user: User = Depends(get_current_user),
):
    return await list_issue_reports(user.id, user.role == "admin", status)


@router.post("", response_model=IssueReportItem, status_code=201)
async def post_report(body: IssueReportCreate, user: User = Depends(get_current_user)):
    title = body.title.strip()
    description = body.description.strip()
    if len(title) < 3:
        raise HTTPException(400, "El título debe tener al menos 3 caracteres")
    if len(description) < 10:
        raise HTTPException(400, "La descripción debe tener al menos 10 caracteres")

    saved_urls: list[str] = []
    attachments: list[dict] = []
    try:
        for evidence in body.attachments:
            filename = Path(evidence.filename.replace("\\", "/")).name or "captura.png"
            content_type = normalize_media_content_type(evidence.content_type, filename)
            if content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise HTTPException(400, "La evidencia debe ser una imagen JPG, PNG o WebP")
            try:
                raw = base64.b64decode(evidence.data_base64, validate=True)
            except Exception:
                raise HTTPException(400, "Una de las evidencias no es una imagen válida")
            if not raw:
                raise HTTPException(400, "Una de las evidencias está vacía")
            if len(raw) > MAX_EVIDENCE_BYTES:
                raise HTTPException(413, "Cada evidencia puede pesar hasta 5 MB")
            media_url = await asyncio.to_thread(
                save_media_file,
                content_type,
                evidence.data_base64,
                filename,
            )
            saved_urls.append(media_url)
            attachments.append({
                "media_url": media_url,
                "filename": filename,
                "content_type": content_type,
                "size_bytes": len(raw),
            })

        report = await create_issue_report(
            {
                "title": title,
                "description": description,
                "current_path": body.current_path,
                "lead_id": str(body.lead_id) if body.lead_id else None,
                "technical_context": body.technical_context,
            },
            attachments,
            user.id,
        )
    except HTTPException:
        await _delete_saved(saved_urls)
        raise
    except IntegrityError:
        await _delete_saved(saved_urls)
        raise HTTPException(400, "El contexto del reporte ya no es válido")
    except (MediaStorageError, ValueError) as exc:
        await _delete_saved(saved_urls)
        raise HTTPException(503 if isinstance(exc, MediaStorageError) else 400, str(exc))
    except Exception:
        await _delete_saved(saved_urls)
        raise

    try:
        for admin_id in await list_active_admin_ids():
            if admin_id == user.id:
                continue
            notification = await create_system_notification(
                admin_id,
                NotificationType.ISSUE_REPORT,
                f"Nuevo reporte {report['public_code']}",
                f"{user.name}: {report['title']}",
                source_id=str(report["id"]),
                metadata={"issue_report_id": report["id"]},
            )
            await manager.send_to_user(admin_id, {
                "type": "notification_created",
                "notification": notification,
            })
    except Exception:
        # El reporte ya quedó persistido; un aviso no puede convertir ese éxito
        # en un 500 que invite al vendedor a enviarlo otra vez.
        logger.exception("No se pudo avisar a los administradores del reporte %s", report["id"])
    await manager.broadcast({"type": "issue_reports_updated"})
    return report


@router.get("/{report_id}", response_model=IssueReportItem)
async def get_report(report_id: int, user: User = Depends(get_current_user)):
    report = await get_issue_report(report_id)
    if report is None:
        raise HTTPException(404, "Reporte no encontrado")
    if user.role != "admin" and report["reporter_user_id"] != user.id:
        raise HTTPException(403, "No puedes ver el reporte de otro usuario")
    return report


@router.patch("/{report_id}", response_model=IssueReportItem)
async def patch_report(
    report_id: int,
    body: IssueReportUpdate,
    user: User = Depends(get_current_user),
):
    if user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede cambiar el estado")
    previous = await get_issue_report(report_id)
    if previous is None:
        raise HTTPException(404, "Reporte no encontrado")
    report = await update_issue_report_status(report_id, body.status, user.id)
    assert report is not None
    if report["reporter_user_id"] != user.id and previous["status"] != report["status"]:
        labels = {
            IssueReportStatus.NEW: "Nuevo",
            IssueReportStatus.IN_REVIEW: "En revisión",
            IssueReportStatus.RESOLVED: "Resuelto",
        }
        try:
            notification = await create_system_notification(
                report["reporter_user_id"],
                NotificationType.ISSUE_REPORT,
                f"{report['public_code']} · {labels[body.status]}",
                report["title"],
                source_id=str(report["id"]),
                metadata={"issue_report_id": report["id"]},
            )
            await manager.send_to_user(report["reporter_user_id"], {
                "type": "notification_created",
                "notification": notification,
            })
        except Exception:
            logger.exception("No se pudo avisar al autor del reporte %s", report["id"])
    await manager.broadcast({"type": "issue_reports_updated"})
    return report
