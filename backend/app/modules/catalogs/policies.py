"""Reglas de renombre del catálogo, independientes de SQL y HTTP."""

from app.modules.catalogs.events import ServiceUsage


def rename_service_references(value, old_name: str, new_name: str):
    """Cambia referencias estructuradas sin tocar texto libre de los mensajes."""
    if isinstance(value, list):
        changed = False
        result = []
        for item in value:
            next_item, item_changed = rename_service_references(item, old_name, new_name)
            result.append(next_item)
            changed = changed or item_changed
        return result, changed
    if not isinstance(value, dict):
        return value, False

    changed = False
    result = {}
    for key, item in value.items():
        next_item, item_changed = rename_service_references(item, old_name, new_name)
        result[key] = next_item
        changed = changed or item_changed

    service = result.get("service")
    if (
        result.get("type") == "change_service"
        and isinstance(service, str)
        and service.casefold() == old_name.casefold()
    ):
        result["service"] = new_name
        changed = True
    condition = result.get("service_contains")
    if isinstance(condition, str) and condition.casefold() == old_name.casefold():
        result["service_contains"] = new_name
        changed = True
    return result, changed


def references_service(value, name: str) -> bool:
    """Si una regla nombra al servicio en sus partes estructuradas (las mismas
    que sigue ``rename_service_references``)."""
    if isinstance(value, list):
        return any(references_service(item, name) for item in value)
    if not isinstance(value, dict):
        return False
    wanted = name.casefold()
    service = value.get("service")
    if value.get("type") == "change_service" and isinstance(service, str) and service.casefold() == wanted:
        return True
    condition = value.get("service_contains")
    if isinstance(condition, str) and condition.casefold() == wanted:
        return True
    return any(references_service(item, name) for item in value.values())


# Cuántos de cada cosa se nombran: para ir a revisarlos alcanza; el total
# va en la etiqueta.
USAGE_ITEMS = 10


def describe_usage(kind: str, count: int, singular: str, plural: str, items=()):
    """Cómo cada módulo anota lo que usa un servicio: "1 lead" / "12 leads",
    con hasta ``USAGE_ITEMS`` de ellos (id, nombre)."""
    return ServiceUsage(
        kind=kind,
        label=f"{count} {singular if count == 1 else plural}",
        items=tuple((str(item_id), name) for item_id, name in list(items)[:USAGE_ITEMS]),
        count=count,
    )
