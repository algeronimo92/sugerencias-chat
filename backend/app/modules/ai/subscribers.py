"""Reacciones de ``ai`` a eventos de otros módulos."""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.ai.knowledge_repository import documents_for_service
from app.modules.catalogs.public import ServiceDeletionRequested, describe_usage


@subscribe(ServiceDeletionRequested, phase=Phase.TRANSACTION)
async def report_service_usage(event: ServiceDeletionRequested) -> None:
    """Un documento de conocimiento es la ficha de su servicio: borrar el
    servicio lo dejaría como conocimiento general (``ON DELETE SET NULL``) y
    el copiloto seguiría ofreciendo algo que ya no existe."""
    documents = await documents_for_service(event.service_id)
    if documents:
        event.usages.append(describe_usage(
            "documentos", len(documents), "documento de conocimiento", "documentos de conocimiento", documents,
        ))
