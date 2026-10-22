"""Pantalla "Asistente IA" del negocio: lo que el asistente sabe de él.

El negocio no configura workflows, URLs ni modelos (eso es de la plataforma):
solo carga su perfil, sus documentos de conocimiento y qué archivos de su
biblioteca puede proponer el asistente como adjuntos. Solo administradores.
"""

from __future__ import annotations
from app.modules.ai.schemas import (AIProfileBody, AIProfileItem, KnowledgeDocumentBody, KnowledgeDocumentSummary, KnowledgeDocumentItem, AIResourceBody)

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.modules.auth.public import User
from app.modules.media.schemas import MediaAssetItem
from app.modules.ai.ai_assistant_service import PROFILE_FIELDS, get_profile, update_profile
from app.modules.auth.public import require_admin
from app.modules.ai.knowledge_service import (
    MAX_CONTENT_LENGTH,
    MAX_TITLE_LENGTH,
    KnowledgeLimitError,
    create_document,
    delete_document,
    get_document,
    list_documents,
    update_document,
)
from app.modules.media.ports.media_library_service import (set_media_asset_ai_description)

router = APIRouter(prefix="/api/ai", tags=["ai-assistant"])


@router.get("/profile", response_model=AIProfileItem)
async def read_profile():
    return await get_profile()


@router.put("/profile", response_model=AIProfileItem)
async def write_profile(body: AIProfileBody, admin: User = Depends(require_admin)):
    values = body.model_dump(include=set(PROFILE_FIELDS))
    try:
        return await update_profile(values, admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/knowledge", response_model=list[KnowledgeDocumentSummary])
async def read_knowledge():
    return await list_documents()


@router.get("/knowledge/{document_id}", response_model=KnowledgeDocumentItem)
async def read_knowledge_document(document_id: UUID):
    document = await get_document(str(document_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return document


@router.post("/knowledge", response_model=KnowledgeDocumentItem, status_code=201)
async def create_knowledge_document(body: KnowledgeDocumentBody):
    try:
        return await create_document(body.title, body.content)
    except KnowledgeLimitError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/knowledge/{document_id}", response_model=KnowledgeDocumentItem)
async def update_knowledge_document(document_id: UUID, body: KnowledgeDocumentBody):
    try:
        document = await update_document(str(document_id), body.title, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if document is None:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return document


@router.delete("/knowledge/{document_id}")
async def delete_knowledge_document(document_id: UUID):
    if not await delete_document(str(document_id)):
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return {"status": "ok"}


@router.patch("/resources/{asset_id}", response_model=MediaAssetItem)
async def update_ai_resource(asset_id: int, body: AIResourceBody):
    asset = await set_media_asset_ai_description(asset_id, body.ai_description)
    if asset is None:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return asset
