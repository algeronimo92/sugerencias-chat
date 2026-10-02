"""Modelos ORM del dominio ai."""

from datetime import datetime
from typing import Any
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AIJob(Base):
    """Autorización tenant-scoped para una invocación de IA/n8n.

    No declara ``schema``: se crea y consulta dentro de cada schema tenant por
    medio de ``tenant_session``. Nunca debe incorporarse al plano de control.
    """

    __tablename__ = "ai_jobs"
    __table_args__ = (
        CheckConstraint(
            "operation IN ('rag', 'analyst', 'media_analysis')",
            name="ai_jobs_operation_check",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed', 'expired', 'applied')",
            name="ai_jobs_status_check",
        ),
        Index("idx_ai_jobs_status_expiry", "status", "expires_at"),
        Index("idx_ai_jobs_chat_created", "chat_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    resource_id: Mapped[str] = mapped_column(Text, nullable=False)
    chat_id: Mapped[str | None] = mapped_column(Text)
    # Revisión opaca (p.ej. v1:<sha256>), distinta de conversacion_version.
    context_revision: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="pending", server_default="pending"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    request_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)


class KnowledgeDocument(Base):
    """Documento RAG aislado por el search_path del tenant."""

    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    document_type: Mapped[str | None] = mapped_column(Text)
    # Texto completo tal como lo cargó el negocio. Los chunks se derivan de acá
    # y se regeneran al editarlo; nunca se editan sueltos.
    content: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class AIProfile(Base):
    """Perfil del negocio que el asistente IA recibe en cada job.

    Una sola fila por schema tenant (``id = 1``). Son datos del negocio, no
    instrucciones de sistema: el prompt base del copiloto lo mantiene la
    plataforma y estos campos entran como contexto acotado.
    """

    __tablename__ = "ai_profile"
    __table_args__ = (CheckConstraint("id = 1", name="ai_profile_singleton_check"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1, server_default=text("1"))
    business_name: Mapped[str | None] = mapped_column(Text)
    business_description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    opening_hours: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str | None] = mapped_column(Text)
    tone: Mapped[str | None] = mapped_column(Text)
    always_rules: Mapped[str | None] = mapped_column(Text)
    never_rules: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class KnowledgeChunk(Base):
    """Fragmento lexical; una futura columna vectorial no cambia el aislamiento."""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        Index("uq_knowledge_chunks_document_ordinal", "document_id", "ordinal", unique=True),
        Index(
            "idx_knowledge_chunks_search_es",
            text("to_tsvector('spanish'::regconfig, content)"),
            postgresql_using="gin",
        ),
    )

    id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    document_id: Mapped[str] = mapped_column(
        PG_UUID(as_uuid=False),
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
