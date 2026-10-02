"""Modelos ORM del dominio media."""

from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    media_url: Mapped[str] = mapped_column(Text, unique=True)
    content_type: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Con descripción, el asistente IA puede proponer este archivo como
    # adjunto de una sugerencia; sin ella no lo ve.
    ai_description: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("idx_media_assets_created_at", created_at.desc()),
        Index("idx_media_assets_content_type", content_type),
        Index("idx_media_assets_uploaded_by", uploaded_by_user_id),
    )
