"""Contratos de catálogos consumidos por otros dominios."""

from app.modules.catalogs.events import ServiceDeletionRequested, ServiceRenamed, TemplatesChanged
from app.modules.catalogs.policies import count_label, references_service, rename_service_references
from app.modules.catalogs.starter_repository import onboarding_catalog_status, seed_starter_catalog
from app.modules.catalogs.tag_schema import Tag

__all__ = ["ServiceDeletionRequested", "ServiceRenamed",
    "TemplatesChanged", "Tag", "count_label", "onboarding_catalog_status", "references_service",
    "rename_service_references", "seed_starter_catalog"]
