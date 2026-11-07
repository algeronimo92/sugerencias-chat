"""Errores de los catálogos."""


class TagAlreadyExistsError(Exception):
    pass


class LeadServiceAlreadyExistsError(Exception):
    pass


class ServicePackageAlreadyExistsError(Exception):
    """Ya hay un paquete con ese nombre dentro del mismo servicio."""
