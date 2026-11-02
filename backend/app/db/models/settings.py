"""Modelos ORM del dominio settings."""

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AppSetting(Base):
    """Configuración editable desde la app (API keys de servicios externos:
    n8n, Meta, ElevenLabs, y los que se vayan sumando). Los valores acá
    tienen prioridad sobre las variables de entorno homónimas — ver
    app/modules/platform/settings_service.py."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
