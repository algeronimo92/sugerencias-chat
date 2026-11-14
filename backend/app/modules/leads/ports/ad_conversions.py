"""Contrato explícito para otros módulos: el estado de la API de
Conversiones de Meta y las claves de su configuración."""

from app.modules.leads.attribution.commands import (
    ACCEPTED_AT_KEY,
    ACCEPTED_BY_KEY,
    DATASET_KEY,
    ENABLED_KEY,
    TEST_CODE_KEY,
)
from app.modules.leads.attribution.queries import conversion_events, conversions_summary

__all__ = [
    "ACCEPTED_AT_KEY",
    "ACCEPTED_BY_KEY",
    "DATASET_KEY",
    "ENABLED_KEY",
    "TEST_CODE_KEY",
    "conversion_events",
    "conversions_summary",
]
