from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Lead(Base):
    __tablename__ = "leads"

    remote_jid: Mapped[str] = mapped_column(Text, primary_key=True)
    telefono: Mapped[str | None] = mapped_column(Text)
    nombre: Mapped[str | None] = mapped_column(Text)
    servicio_interes: Mapped[str | None] = mapped_column(Text)
    vendedor: Mapped[str | None] = mapped_column(Text)
    origen: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)


class WspMessage(Base):
    __tablename__ = "wsp_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    chat_id: Mapped[str] = mapped_column(Text)
    sender: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    media_url: Mapped[str | None] = mapped_column(Text)
