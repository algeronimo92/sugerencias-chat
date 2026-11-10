"""Texto de un PDF para cargarlo como documento de conocimiento.

Se extrae y se devuelve para que el admin lo revise antes de guardar: una
ficha exportada de Word o de Canva trae saltos raros que conviene ver. Un PDF
escaneado (imágenes sin texto) se rechaza: el reconocimiento de texto (OCR)
queda fuera de alcance.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import re

from app.modules.ai.knowledge_service import MAX_CONTENT_LENGTH

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 200
# Menos texto que esto por página es, en la práctica, un escaneo o un diseño
# hecho de imágenes.
MIN_CHARS_PER_PAGE = 20


class PdfImportError(ValueError):
    pass


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    # Guiones de corte de línea ("trata-\nmiento") y espacios repetidos.
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_text(data: bytes) -> tuple[str, int]:
    import pypdfium2 as pdfium

    try:
        document = pdfium.PdfDocument(data)
    except Exception as exc:
        raise PdfImportError("El archivo no es un PDF válido o está protegido con contraseña") from exc
    try:
        pages = len(document)
        if pages == 0:
            raise PdfImportError("El PDF no tiene páginas")
        if pages > MAX_PDF_PAGES:
            raise PdfImportError(f"El PDF tiene {pages} páginas; el máximo es {MAX_PDF_PAGES}")
        parts = []
        for index in range(pages):
            textpage = document[index].get_textpage()
            try:
                parts.append(textpage.get_text_range())
            finally:
                textpage.close()
    finally:
        document.close()
    text = _clean("\n\n".join(parts))
    if len(text) < MIN_CHARS_PER_PAGE * pages:
        raise PdfImportError(
            "El PDF casi no tiene texto seleccionable: parece escaneado o hecho de imágenes. "
            "Cópialo como texto o expórtalo de nuevo desde el documento original."
        )
    return text, pages


async def import_pdf(filename: str, data_base64: str) -> dict:
    try:
        data = base64.b64decode(data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PdfImportError("El archivo llegó dañado") from exc
    if len(data) > MAX_PDF_BYTES:
        raise PdfImportError("El PDF supera los 10 MB")
    text, pages = await asyncio.to_thread(extract_pdf_text, data)
    truncated = len(text) > MAX_CONTENT_LENGTH
    title = re.sub(r"\.pdf$", "", (filename or "").strip(), flags=re.I).strip() or "Documento PDF"
    return {
        "title": title[:200],
        "content": text[:MAX_CONTENT_LENGTH],
        "pages": pages,
        "characters": min(len(text), MAX_CONTENT_LENGTH),
        "truncated": truncated,
    }
