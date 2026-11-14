"""Contrato explícito para otros módulos: clics de anuncios y su envío a
la API de Conversiones de Meta."""

from app.modules.leads.ad_conversions import record_ad_click, send_pending_conversions
from app.modules.leads.ad_conversions_queries import conversions_summary

__all__ = ["conversions_summary", "record_ad_click", "send_pending_conversions"]
