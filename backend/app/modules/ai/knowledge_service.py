"""Documentos de conocimiento que cada negocio carga para el asistente IA.

El negocio edita el texto completo del documento; los fragmentos que busca el
copiloto de sugerencias (ver app/modules/ai/knowledge_search.py) se derivan de
ese texto y se regeneran enteros en cada edición, nunca por separado.
"""

from __future__ import annotations

import re
from app.modules.ai import knowledge_repository
from app.modules.ai.errors import KnowledgeLimitError
from app.modules.platform.ports.knowledge_templates import get_active_template, list_templates


MAX_TITLE_LENGTH = 200
MAX_CONTENT_LENGTH = 100_000
MAX_DOCUMENTS = 200
# Fragmentos del tamaño de una ficha o un párrafo largo: la búsqueda es
# lexical, y un fragmento enorme empataría con casi cualquier consulta.
CHUNK_TARGET_CHARS = 1200
CHUNK_OVERLAP_CHARS = 150
# Sube cuando cambia cómo se trocea: al arrancar, los documentos guardados
# con una versión anterior se vuelven a trocear (``rechunk_outdated_documents``).
# 2 (2026-11-09): conserva los saltos de línea dentro de un párrafo (listas,
# guiones) y el solape arranca en una oración entera.
CHUNKER_VERSION = 2

# Fin de oración o salto de línea: donde se puede cortar sin partir una idea.
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+|\n")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(\S.*)$", re.MULTILINE)


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


def _overlap_tail(chunk: str, overlap: int) -> str:
    """La cola del fragmento anterior con la que arranca el siguiente, desde
    el comienzo de una oración o de una línea. Antes se cortaba en el primer
    espacio y 13 de los 26 fragmentos del guion de WhatsApp empezaban a
    mitad de frase (2026-11-09)."""
    if not overlap:
        return ""
    tail = chunk[-overlap:]
    boundary = _SENTENCE_END_RE.search(tail)
    if boundary is not None:
        return tail[boundary.end():].strip()
    return tail[tail.find(" ") + 1:].strip() if " " in tail else tail


def _chunk_plain(content: str, target: int, overlap: int) -> list[str]:
    """Agrupa párrafos hasta ``target`` caracteres.

    Un párrafo más largo que ``target`` se parte por oraciones o líneas. Cada
    fragmento arranca con la cola del anterior para que una idea cortada en
    el borde siga encontrándose desde cualquiera de los dos. Los saltos de
    línea dentro de un párrafo se conservan: una lista de viñetas o los
    turnos de un guion aplastados en una sola línea perdían su forma y el
    modelo los leía como una frase corrida.
    """

    paragraphs = [
        "\n".join(" ".join(line.split()) for line in block.split("\n") if line.strip())
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
            tail = _overlap_tail(current, overlap)
            current = f"{tail}\n\n{piece}" if tail else piece
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _sections(content: str) -> list[tuple[str, str]]:
    """Corta en cada encabezado markdown; devuelve (ruta de encabezados, cuerpo)."""

    sections: list[tuple[str, str]] = []
    trail: list[tuple[int, str]] = []
    body: list[str] = []

    def flush() -> None:
        text = "\n".join(body).strip()
        if text:
            sections.append((" › ".join(title for _level, title in trail), text))
        body.clear()

    for line in content.replace("\r\n", "\n").split("\n"):
        match = _HEADING_RE.match(line)
        if match is None:
            body.append(line)
            continue
        flush()
        level = len(match.group(1))
        trail = [(lvl, title) for lvl, title in trail if lvl < level]
        trail.append((level, match.group(2).strip().strip("#").strip()))
    flush()
    return sections


def chunk_text(
    content: str,
    *,
    target: int = CHUNK_TARGET_CHARS,
    overlap: int = CHUNK_OVERLAP_CHARS,
) -> list[str]:
    """Fragmentos para la búsqueda.

    Con encabezados markdown, cada sección es su propio fragmento (o varios, si
    pasa de ``target``) y arranca con su ruta de encabezados: así un dolor, una
    ficha o una objeción no se mezcla con la vecina y el fragmento se entiende
    solo. Es el mismo criterio con el que se armaba el índice vectorial de n8n,
    que ya cortaba una sección por fragmento. Sin encabezados, agrupa párrafos.
    """

    if not _HEADING_RE.search(content):
        return _chunk_plain(content, target, overlap)
    chunks: list[str] = []
    for trail, body in _sections(content):
        prefix = f"[{trail}]\n\n" if trail else ""
        chunks.extend(f"{prefix}{chunk}" for chunk in _chunk_plain(body, target, overlap))
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


# Para qué sirve el documento: le dice al copiloto cómo usarlo y al admin
# cómo ordenarlos. Sin valor = "otro".
DOCUMENT_TYPES = ("ficha", "politica", "faq", "guion", "otro")


def _validate_type(document_type: str | None) -> str | None:
    if document_type in (None, ""):
        return None
    if document_type not in DOCUMENT_TYPES:
        raise ValueError("Tipo de documento desconocido")
    return document_type


MAX_SERVICES_PER_DOCUMENT = 50


def _clean_service_ids(service_ids: list[int] | None) -> list[int]:
    """Sin repetidos y en el orden en que se eligieron."""
    cleaned = list(dict.fromkeys(int(service_id) for service_id in service_ids or []))
    if len(cleaned) > MAX_SERVICES_PER_DOCUMENT:
        raise ValueError(f"Un documento admite hasta {MAX_SERVICES_PER_DOCUMENT} servicios")
    return cleaned


async def create_document(
    title: str, content: str, document_type: str | None = None, *, service_ids: list[int] | None = None,
    source: str = "manual", metadata: dict | None = None,
) -> dict:
    title, content = _validate(title, content)
    return await knowledge_repository.create_document(
        title, content, _validate_type(document_type), chunk_text(content), MAX_DOCUMENTS,
        service_ids=_clean_service_ids(service_ids), source=source, metadata=metadata,
        chunker_version=CHUNKER_VERSION,
    )


async def rechunk_outdated_documents() -> int:
    """Vuelve a trocear los documentos guardados con un troceador anterior.
    Corre en el mantenimiento de arranque, una vez por versión y por negocio;
    los vectores de los fragmentos nuevos se calculan en la próxima
    sugerencia. Devuelve cuántos documentos retroceó."""
    outdated = await knowledge_repository.documents_chunked_before(CHUNKER_VERSION)
    for document_id, content in outdated:
        await knowledge_repository.replace_chunks(document_id, chunk_text(content), CHUNKER_VERSION)
    return len(outdated)


class TemplateNotFound(LookupError):
    pass


async def list_importable_templates() -> list[dict]:
    """Las plantillas activas de la plataforma, marcando las que el negocio ya
    importó (puede volver a importarlas: cada importación es una copia nueva)."""
    imported = await knowledge_repository.imported_template_ids()
    return [
        {**template, "characters": len(template["content"]), "imported": template["id"] in imported}
        for template in await list_templates()
    ]


async def import_template(template_id: int, *, service_ids: list[int] | None = None) -> dict:
    """Copia la plantilla como documento propio del negocio, listo para editar."""
    template = await get_active_template(template_id)
    if template is None:
        raise TemplateNotFound(template_id)
    return await create_document(
        template["title"], template["content"], template["document_type"],
        service_ids=service_ids, source="plantilla",
        metadata={"template_id": template["id"], "template_version": template["version"]},
    )


async def update_document(
    document_id: str, title: str, content: str, *, document_type: str | None = None,
    service_ids: list[int] | None = None,
) -> dict | None:
    title, content = _validate(title, content)
    return await knowledge_repository.update_document(
        document_id, title, content, chunk_text(content),
        document_type=_validate_type(document_type), service_ids=_clean_service_ids(service_ids),
        chunker_version=CHUNKER_VERSION,
    )


async def delete_document(document_id: str) -> bool:
    return await knowledge_repository.delete_document(document_id)
