import asyncio
import base64
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.db.models.auth import User
from app.modules.issue_reports.types import IssueReportPriority, IssueReportStatus
from app.modules.issue_reports.schemas import (
    IssueReportCommentCreate,
    IssueReportCommentItem,
    IssueReportCreate,
    IssueReportDetail,
    IssueReportItem,
    IssueReportUpdate,
)
from app.modules.media.ports.media_upload import (normalize_media_content_type, save_media_file)
from app.modules.auth.public import get_current_user
from app.modules.issue_reports.queries import get_issue_report, get_issue_report_detail, list_issue_reports
from app.modules.issue_reports.service import (
    InvalidReportContextError,
    comment_issue_report,
    file_issue_report,
    update_issue_report,
)
from app.integrations.storage.media_storage import (MediaStorageError, delete_media)


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
    priority: IssueReportPriority | None = None,
    user: User = Depends(get_current_user),
):
    return await list_issue_reports(user.id, user.role == "admin", status, priority)


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

        report = await file_issue_report(
            {
                "title": title,
                "description": description,
                "current_path": body.current_path,
                "lead_id": str(body.lead_id) if body.lead_id else None,
                "technical_context": body.technical_context,
            },
            attachments,
            reporter_id=user.id,
            reporter_name=user.name,
        )
    except HTTPException:
        await _delete_saved(saved_urls)
        raise
    except InvalidReportContextError as exc:
        await _delete_saved(saved_urls)
        raise HTTPException(400, str(exc))
    except (MediaStorageError, ValueError) as exc:
        await _delete_saved(saved_urls)
        raise HTTPException(503 if isinstance(exc, MediaStorageError) else 400, str(exc))
    except Exception:
        await _delete_saved(saved_urls)
        raise

    return report


@router.get("/{report_id}", response_model=IssueReportDetail)
async def get_report(report_id: int, user: User = Depends(get_current_user)):
    report = await get_issue_report_detail(report_id)
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
    report = await update_issue_report(report_id, body.status, body.priority, user.id)
    if report is None:
        raise HTTPException(404, "Reporte no encontrado")
    return report


@router.post("/{report_id}/comments", response_model=IssueReportCommentItem, status_code=201)
async def post_report_comment(
    report_id: int,
    body: IssueReportCommentCreate,
    user: User = Depends(get_current_user),
):
    report = await get_issue_report(report_id)
    if report is None:
        raise HTTPException(404, "Reporte no encontrado")
    if user.role != "admin" and report["reporter_user_id"] != user.id:
        raise HTTPException(403, "No puedes comentar el reporte de otro usuario")
    content = body.content.strip()
    if not content:
        raise HTTPException(400, "El comentario no puede estar vacío")
    comment = await comment_issue_report(
        report, author_id=user.id, author_name=user.name, author_is_admin=user.role == "admin", content=content,
    )
    return comment
