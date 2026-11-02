"""Documentos de conocimiento que cada negocio carga para el asistente IA.

El negocio edita el texto completo del documento; los fragmentos que consulta
``/api/webhooks/rag-search`` (ver app/modules/ai/knowledge_search.py) se derivan de
ese texto y se regeneran enteros en cada edición, nunca por separado.
"""

from __future__ import annotations

import re
from app.modules.ai import knowledge_repository
from app.modules.ai.errors import KnowledgeLimitError


MAX_TITLE_LENGTH = 200
MAX_CONTENT_LENGTH = 100_000
MAX_DOCUMENTS = 200
# Fragmentos del tamaño de una ficha o un párrafo largo: la búsqueda es
# lexical, y un fragmento enorme empataría con casi cualquier consulta.
CHUNK_TARGET_CHARS = 1200
CHUNK_OVERLAP_CHARS = 150

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")


def _hard_split(text: str, size: int) -> list[str]:
    parts = []
    for sentence in _SENTENCE_END_RE.split(text):
        while len(sentence) > size:
            cut = sentence.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            parts.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if sentence:
            parts.append(sentence)
    return parts


def chunk_text(
    content: str,
    *,
    target: int = CHUNK_TARGET_CHARS,
    overlap: int = CHUNK_OVERLAP_CHARS,
) -> list[str]:
    """Agrupa párrafos hasta ``target`` caracteres.

    Un párrafo más largo que ``target`` se parte por oraciones. Cada fragmento
    arranca con la cola del anterior para que una idea cortada en el borde
    siga encontrándose desde cualquiera de los dos.
    """

    paragraphs = [
        " ".join(block.split())
        for block in re.split(r"\n\s*\n", content.replace("\r\n", "\n"))
    ]
    pieces: list[str] = []
    for paragraph in paragraphs:
        if not paragraph:
            continue
        pieces.extend(_hard_split(paragraph, target) if len(paragraph) > target else [paragraph])

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if current and len(candidate) > target:
            chunks.append(current)
            tail = current[-overlap:]
            tail = tail[tail.find(" ") + 1:] if " " in tail else tail
            current = f"{tail} {piece}".strip() if overlap else piece
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _validate(title: str, content: str) -> tuple[str, str]:
    title = " ".join(title.split())
    content = content.replace("\r\n", "\n").strip()
    if not title:
        raise ValueError("El título es obligatorio")
    if len(title) > MAX_TITLE_LENGTH:
        raise ValueError(f"El título supera los {MAX_TITLE_LENGTH} caracteres")
    if not content:
        raise ValueError("El documento no tiene texto")
    if len(content) > MAX_CONTENT_LENGTH:
        raise ValueError(f"El documento supera los {MAX_CONTENT_LENGTH} caracteres")
    return title, content


async def list_documents() -> list[dict]:
    return await knowledge_repository.list_documents()


async def get_document(document_id: str) -> dict | None:
    return await knowledge_repository.get_document(document_id)


async def create_document(title: str, content: str, document_type: str | None = None) -> dict:
    title, content = _validate(title, content)
    return await knowledge_repository.create_document(title, content, document_type, chunk_text(content), MAX_DOCUMENTS)


async def update_document(document_id: str, title: str, content: str) -> dict | None:
    title, content = _validate(title, content)
    return await knowledge_repository.update_document(document_id, title, content, chunk_text(content))


async def delete_document(document_id: str) -> bool:
    return await knowledge_repository.delete_document(document_id)
