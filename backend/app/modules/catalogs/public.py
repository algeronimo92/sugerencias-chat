"""Contratos de catálogos consumidos por otros dominios."""

from app.modules.catalogs.events import ServiceRenamed, TemplatesChanged
from app.modules.catalogs.policies import rename_service_references
from app.modules.catalogs.starter_repository import onboarding_catalog_status, seed_starter_catalog
from app.modules.catalogs.tag_schema import Tag

__all__ = ["ServiceRenamed",
    "TemplatesChanged", "Tag", "onboarding_catalog_status", "rename_service_references",
    "seed_starter_catalog"]
