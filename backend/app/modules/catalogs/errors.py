"""Errores de los catálogos."""


class TagAlreadyExistsError(Exception):
    pass


class LeadServiceAlreadyExistsError(Exception):
    pass


class ServicePackageAlreadyExistsError(Exception):
    """Ya hay un paquete con ese nombre dentro del mismo servicio."""


class ErpManagedError(Exception):
    """El servicio lo administra el ERP del negocio: nombre, paquetes y
    alta/baja se cambian allí y se sincronizan, no en el CRM."""
