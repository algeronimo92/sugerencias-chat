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


class ServiceInUseError(Exception):
    """Algo del negocio todavía nombra al servicio (leads, ventas, plantillas,
    reglas, documentos de la IA). Borrarlo dejaría esas referencias huérfanas:
    para sacarlo de las listas está "Desactivar", que conserva el historial."""

    def __init__(self, usages):
        self.usages = list(usages)
        super().__init__(", ".join(usage.label for usage in self.usages))
