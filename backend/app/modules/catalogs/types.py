"""Tipos de plantilla del CRM."""

from enum import StrEnum


class TemplateType(StrEnum):
    INTERNAL = "internal"
    OFFICIAL = "official"


class InteractiveType(StrEnum):
    """Subtipo interactivo de una plantilla del CRM: el literal de Meta."""

    NONE = "none"
    BUTTON = "button"
    LIST = "list"
