"""Contratos de catálogos consumidos por otros dominios."""

from app.modules.catalogs.events import ServiceDeletionRequested, ServiceRenamed, ServiceUsage, TemplatesChanged
from app.modules.catalogs.policies import USAGE_ITEMS, describe_usage, filters_by_service, rename_service_references, sets_service
from app.modules.catalogs.starter_repository import onboarding_catalog_status, seed_starter_catalog
from app.modules.catalogs.tag_schema import Tag

__all__ = ["ServiceDeletionRequested", "ServiceRenamed", "ServiceUsage",
    "TemplatesChanged", "Tag", "USAGE_ITEMS", "describe_usage", "onboarding_catalog_status", "filters_by_service", "sets_service",
    "rename_service_references", "seed_starter_catalog"]
