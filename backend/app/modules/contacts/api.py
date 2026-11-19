"""Rutas de la agenda. Leer y editar contactos lo puede cualquier usuario del
CRM; importar, borrar y configurar la sincronización, solo un administrador."""

import base64
import binascii
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.modules.auth.public import User, get_current_user, require_admin
from app.modules.contacts import import_service, service
from app.modules.contacts.queries import (
    batch_rows, batch_summary, get_contact, list_batches, list_contacts, list_tags,
)
from app.modules.contacts.schemas import (
    AffectedCount, ContactCreate, ContactIds, ContactItem, ContactPage, ContactTagsChange, ContactUpdate,
    CsvImportCreate, CsvPreview, CsvUpload, ImportResult, ImportRowPage, ImportSelection, ImportSummary,
    PromotedLead, PromotedLeads,
)
from app.modules.contacts.types import ContactOrigin

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _decode(body: CsvUpload) -> bytes:
    try:
        return base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "El archivo no llegó bien: vuelve a subirlo")


@router.get("", response_model=ContactPage)
async def get_contacts(
    search: str | None = Query(default=None, max_length=100),
    origen: ContactOrigin | None = None,
    tag: str | None = Query(default=None, max_length=40),
    has_lead: bool | None = None,
    removed_in_app: bool | None = None,
    consent: bool | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _user: User = Depends(get_current_user),
):
    return await list_contacts(
        search=search, origen=origen, tag=tag, has_lead=has_lead, removed_in_app=removed_in_app,
        consent=consent, offset=offset, limit=limit,
    )


@router.get("/tags", response_model=list[str])
async def get_contact_tags(_user: User = Depends(get_current_user)):
    return await list_tags()


@router.post("", response_model=ContactItem, status_code=201)
async def post_contact(body: ContactCreate, user: User = Depends(get_current_user)):
    return await service.create_contact(body.model_dump(), user_id=user.id)


@router.post("/bulk/tags", response_model=AffectedCount)
async def post_bulk_tags(body: ContactTagsChange, _user: User = Depends(get_current_user)):
    return {"count": await service.change_tags(body.id_strings(), add=body.add, remove=body.remove)}


@router.post("/bulk/leads", response_model=PromotedLeads)
async def post_bulk_leads(body: ContactIds, admin: User = Depends(require_admin)):
    promoted, failed = await service.promote_many(body.id_strings(), user_id=admin.id)
    return {"promoted": promoted, "failed": failed}


@router.post("/bulk/delete", response_model=AffectedCount)
async def post_bulk_delete(body: ContactIds, _admin: User = Depends(require_admin)):
    return {"count": await service.delete_contacts(body.id_strings())}


# --- Importaciones ---------------------------------------------------------

@router.post("/imports/csv/preview", response_model=CsvPreview)
async def post_csv_preview(body: CsvUpload, _admin: User = Depends(require_admin)):
    return import_service.preview_csv(_decode(body))


@router.post("/imports/csv", response_model=ImportSummary, status_code=201)
async def post_csv_import(body: CsvImportCreate, admin: User = Depends(require_admin)):
    return await import_service.create_csv_import(
        _decode(body), file_name=body.file_name, mapping=body.mapping.model_dump(), user_id=admin.id,
    )


@router.get("/imports", response_model=list[ImportSummary])
async def get_imports(_admin: User = Depends(require_admin)):
    return await list_batches()


@router.get("/imports/{batch_id}", response_model=ImportSummary)
async def get_import(batch_id: UUID, _admin: User = Depends(require_admin)):
    summary = await batch_summary(str(batch_id))
    if summary is None:
        raise HTTPException(404, "Importación no encontrada")
    return summary


@router.get("/imports/{batch_id}/rows", response_model=ImportRowPage)
async def get_import_rows(
    batch_id: UUID,
    status: Literal["pending", "invalid", "processed"] = "pending",
    search: str | None = Query(default=None, max_length=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    _admin: User = Depends(require_admin),
):
    return await batch_rows(str(batch_id), status=status, search=search, offset=offset, limit=limit)


@router.post("/imports/{batch_id}/confirm", response_model=ImportResult)
async def post_import_confirm(batch_id: UUID, body: ImportSelection, _admin: User = Depends(require_admin)):
    return await import_service.confirm_import(str(batch_id), import_service.Selection(**body.model_dump()))


@router.post("/imports/{batch_id}/discard", status_code=204)
async def post_import_discard(batch_id: UUID, _admin: User = Depends(require_admin)):
    await import_service.discard_import(str(batch_id))
    return Response(status_code=204)


# --- Un contacto -------------------------------------------------------------

@router.get("/{contact_id}", response_model=ContactItem)
async def get_one_contact(contact_id: UUID, _user: User = Depends(get_current_user)):
    contact = await get_contact(str(contact_id))
    if contact is None:
        raise HTTPException(404, "Contacto no encontrado")
    return contact


@router.patch("/{contact_id}", response_model=ContactItem)
async def patch_contact(contact_id: UUID, body: ContactUpdate, _user: User = Depends(get_current_user)):
    return await service.update_contact(str(contact_id), body.model_dump(exclude_unset=True))


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(contact_id: UUID, _admin: User = Depends(require_admin)):
    if not await service.delete_contacts([str(contact_id)]):
        raise HTTPException(404, "Contacto no encontrado")
    return Response(status_code=204)


@router.post("/{contact_id}/lead", response_model=PromotedLead)
async def post_contact_lead(contact_id: UUID, user: User = Depends(get_current_user)):
    return {"lead_id": await service.promote_to_lead(str(contact_id), user_id=user.id)}
