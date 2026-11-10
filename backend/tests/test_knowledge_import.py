"""Importar el texto de un PDF como documento de conocimiento."""

from __future__ import annotations

import base64

import pytest
from fastapi import HTTPException

from app.modules.ai import assistant_api, knowledge_import
from app.modules.ai.knowledge_import import PdfImportError, extract_pdf_text, import_pdf
from app.modules.ai.knowledge_service import DOCUMENT_TYPES, _validate_type
from app.modules.ai.schemas import KnowledgePdfImportRequest
from tests.pdf_factory import make_pdf

FICHA = [
    "Hollywood Peel - Rostro",
    "Peeling con carbon activado y laser. Ideal para manchas y poros dilatados.",
    "Se recomiendan 3 sesiones separadas por 15 dias. Contraindicado en embarazo.",
]


def test_extracts_text_from_every_page():
    text, pages = extract_pdf_text(make_pdf([FICHA, ["Cuidados posteriores: usar protector solar."]]))
    assert pages == 2
    assert "carbon activado" in text and "protector solar" in text
    assert text.index("Hollywood Peel") < text.index("protector solar")


def test_scanned_pdf_is_rejected_with_a_clear_message():
    with pytest.raises(PdfImportError) as error:
        extract_pdf_text(make_pdf([[], []]))
    assert "escaneado" in str(error.value)


def test_not_a_pdf_is_rejected():
    with pytest.raises(PdfImportError) as error:
        extract_pdf_text(b"hola, esto no es un pdf")
    assert "PDF válido" in str(error.value)


async def test_import_returns_title_text_and_flags():
    data = base64.b64encode(make_pdf([FICHA])).decode()
    result = await import_pdf("Ficha Hollywood Peel.pdf", data)
    assert result["title"] == "Ficha Hollywood Peel"
    assert result["pages"] == 1 and result["truncated"] is False
    assert "3 sesiones" in result["content"]


async def test_import_rejects_oversized_or_damaged_uploads(monkeypatch):
    with pytest.raises(PdfImportError):
        await import_pdf("x.pdf", "***no es base64***")
    monkeypatch.setattr(knowledge_import, "MAX_PDF_BYTES", 10)
    with pytest.raises(PdfImportError) as error:
        await import_pdf("x.pdf", base64.b64encode(make_pdf([FICHA])).decode())
    assert "10 MB" in str(error.value)


async def test_long_documents_are_truncated_to_the_document_limit(monkeypatch):
    monkeypatch.setattr(knowledge_import, "MAX_CONTENT_LENGTH", 40)
    result = await import_pdf("x.pdf", base64.b64encode(make_pdf([FICHA])).decode())
    assert result["truncated"] is True and len(result["content"]) == 40


async def test_route_translates_import_errors_to_400():
    with pytest.raises(HTTPException) as error:
        await assistant_api.import_knowledge_pdf(KnowledgePdfImportRequest(filename="scan.pdf", data_base64=base64.b64encode(make_pdf([[]])).decode()))
    assert error.value.status_code == 400


def test_document_types_are_a_closed_list():
    assert _validate_type("ficha") == "ficha" and _validate_type("") is None
    assert set(DOCUMENT_TYPES) == {"ficha", "politica", "faq", "guion", "otro"}
    with pytest.raises(ValueError):
        _validate_type("receta")
