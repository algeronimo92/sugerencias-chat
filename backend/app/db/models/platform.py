"""Modelos ORM del plano tenant que pertenecen al módulo platform."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, Identity, Index, Integer, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WhatsAppPricingDaily(Base):
    """Lo que Meta cobró por WhatsApp, por día, categoría y tipo de precio.

    Copia de ``pricing_analytics`` de la WABA del negocio: es el único lugar
    donde Meta informa montos. El webhook de estado dice si un mensaje se cobró
    y con qué tarifa, pero no cuánto (el precio depende del país, del tramo de
    volumen del mes y de la moneda de la cuenta). Meta advierte que la cifra es
    aproximada y puede corregirse unos días después: la sincronización vuelve
    a pedir los últimos días y reemplaza lo guardado.
    """

    __tablename__ = "whatsapp_pricing_daily"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Día del negocio al que corresponde el punto. Meta corta los días en la
    # zona horaria de la WABA, así que ``period_start`` en UTC puede caer el
    # día anterior; el día es la fecha UTC del punto medio del período, que
    # coincide con la fecha local para cualquier zona de -12 h a +12 h.
    day: Mapped[date] = mapped_column(Date, nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Mercado del destinatario (ISO de 2 letras); '' cuando Meta no lo detalla.
    country: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # Valores literales de Meta: MARKETING, UTILITY, SERVICE, AUTHENTICATION…
    pricing_category: Mapped[str] = mapped_column(Text, nullable=False)
    # REGULAR (cobrado), FREE_CUSTOMER_SERVICE o FREE_ENTRY_POINT.
    pricing_type: Mapped[str] = mapped_column(Text, nullable=False)
    # Tramo de volumen ("0:750000"); '' en los mensajes gratis.
    tier: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    volume: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    cost: Mapped[Decimal] = mapped_column(Numeric(14, 6), nullable=False, server_default="0")
    # Moneda de la WABA: la elige el negocio al crearla y Meta factura en ella.
    currency: Mapped[str | None] = mapped_column(Text)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index(
            "uq_whatsapp_pricing_daily_point",
            day, country, pricing_category, pricing_type, tier,
            unique=True,
        ),
    )
