"""El índice vectorial del conocimiento contra PostgreSQL real: completa los
vectores que faltan, recalcula los de otro modelo, filtra por servicio y se
entera de lo que se edita."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.db.models.auth import User
from app.db.uow import session_scope
from app.integrations.llm.embeddings import DIMENSIONS
from app.modules.ai.knowledge_search import referenced_chunks, search_knowledge_chunks
from app.modules.ai.knowledge_service import create_document, update_document
from app.modules.ai.knowledge_vectors import ensure_embeddings, vector_search
from app.modules.catalogs.service import create_lead_service
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

# Tres "temas" ortogonales: un texto queda en el eje del tema que menciona.
TOPICS = ("flacidez", "manchas", "pagos")


def _vector(text: str) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for axis, topic in enumerate(TOPICS):
        if topic in text.lower():
            vector[axis] = 1.0
    if not any(vector):
        vector[len(TOPICS)] = 1.0
    norm = sum(value * value for value in vector) ** 0.5
    return [value / norm for value in vector]


class TopicEmbedder:
    def __init__(self, spec: str = "openai:text-embedding-3-small@768"):
        self.spec = spec
        self.calls: list[int] = []

    async def embed(self, texts):
        self.calls.append(len(texts))
        return [_vector(text) for text in texts]


async def _ids(query: str, spec: str, service_id: int | None = None) -> list[str]:
    return [chunk_id for chunk_id, _ in await vector_search(_vector(query), spec, 5, service_id)]


async def test_vectors_are_filled_lazily_searched_and_kept_in_sync(tenant) -> None:
    with tenant_context(tenant):
        async with session_scope() as session:
            user = User(email=f"a-{uuid4().hex[:6]}@example.test", name="A", password_hash="!", role="admin", is_active=True, created_at=datetime.now(timezone.utc))
            session.add(user)
            await session.flush()
            admin_id = user.id
        hifu = await create_lead_service("HIFU 12D", admin_id)
        ficha = await create_document("Ficha HIFU", "Tensa la piel con flacidez de rostro y papada.", "ficha", service_id=hifu["id"])
        await create_document("Ficha Peel", "Aclara manchas y poros.", "ficha")
        await create_document("Pagos", "Aceptamos pagos con Yape y tarjeta.", "politica")
        embedder = TopicEmbedder()

        # Sin vectores todavía: la búsqueda por significado no encuentra nada.
        assert await vector_search(_vector("flacidez"), embedder.spec, 5) == []

        assert await ensure_embeddings(embedder) == 3
        assert await ensure_embeddings(embedder) == 0  # ya están todos

        ficha_chunk = (await _ids("tengo flacidez", embedder.spec))[0]
        top_manchas = await vector_search(_vector("manchas en la cara"), embedder.spec, 1)
        assert top_manchas[0][1] > 0.99 and top_manchas[0][0] != ficha_chunk
        # Filtrado por servicio: solo la ficha de HIFU, aunque la consulta hable de pagos.
        assert await _ids("pagos", embedder.spec, hifu["id"]) == [ficha_chunk]

        # Editar rehace los fragmentos: quedan sin vector hasta la siguiente
        # pasada, y el índice en memoria se entera.
        await update_document(ficha["id"], "Ficha HIFU", "Ahora habla de manchas solares.", document_type="ficha", service_id=hifu["id"])
        assert ficha_chunk not in await _ids("flacidez", embedder.spec)
        assert await ensure_embeddings(embedder) == 1
        assert len(await _ids("manchas", embedder.spec)) == 3
        assert (await _ids("manchas", embedder.spec, hifu["id"])) != [ficha_chunk]

        # Otro modelo: los vectores anteriores no sirven y se recalculan todos.
        other = TopicEmbedder("gemini:gemini-embedding-2@768")
        assert await ensure_embeddings(other) == 3
        assert len(await _ids("pagos", other.spec)) == 3


async def test_fragments_bring_the_fichas_they_name(tenant) -> None:
    with tenant_context(tenant):
        await create_document("Ficha: Ácido Tranexámico", "## Ácido Tranexámico\nDespigmentante para melasma.\n\n## Cuidados\nProtector solar estricto.", "ficha")
        await create_document("Ficha: Borrado de Cejas · Borrado de Tatuajes", "Picoláser que fragmenta el pigmento.", "ficha")
        await create_document("Mapa dolor → solución", "## Manchas\nTengo paño en la cara → **Ácido tranexamico** (sin tilde a propósito).\n\n## Tatuajes\nQuiero quitarme un tatuaje → borrado de tatuajes.", "guion")
        await create_document("Ficha: Sol", "Corta: no debe confundirse con 'solar'.", "ficha")

        found = await search_knowledge_chunks("paño or tatuaje", 5)
        mapa = [chunk for chunk in found if chunk["title"] == "Mapa dolor → solución"]
        assert mapa

        referenced = await referenced_chunks(mapa, 3)

        titles = sorted(chunk["title"] for _, chunk in referenced)
        assert titles == ["Ficha: Borrado de Cejas · Borrado de Tatuajes", "Ficha: Ácido Tranexámico"]
        # Solo el primer fragmento de cada ficha, y quién la nombró.
        assert all(chunk["content"].startswith(("[Ácido", "Picoláser")) for _, chunk in referenced)
        assert {referrer for referrer, _ in referenced} <= {chunk["id"] for chunk in mapa}
        # Lo que ya está en el contexto no se repite.
        assert await referenced_chunks(mapa + [chunk for _, chunk in referenced], 3) == []
