import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
            modules.update(f"{node.module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    return modules


@pytest.mark.parametrize(("package", "forbidden_prefix"), [
    ("db", "services"),
    ("services", "routers"),
])
def test_layers_do_not_depend_on_forbidden_packages(package, forbidden_prefix):
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in (BACKEND / package).rglob("*.py")
        for module in _imported_modules(path)
        if module.startswith(forbidden_prefix)
    }

    assert violations == set()


def test_a_router_never_reaches_into_another_router():
    """Un router partido en varios módulos puede hablar entre sus propios
    módulos; lo que no puede es depender de otro router."""
    violations = set()
    for path in (BACKEND / "routers").rglob("*.py"):
        relative = path.relative_to(BACKEND / "routers")
        own = f"routers.{relative.parts[0]}" if len(relative.parts) > 1 else None
        for module in _imported_modules(path):
            if not module.startswith("routers."):
                continue
            if own and (module == own or module.startswith(f"{own}.")):
                continue
            violations.add(f"{path.relative_to(BACKEND)} -> {module}")

    assert violations == set()


@pytest.mark.parametrize("module", [
    "services/message_outbox.py",
    "services/outbound_kinds.py",
    "services/automations/actions.py",
    "services/automations/engine.py",
    "services/automation_deps.py",
    "routers/chats/outbound.py",
    "routers/chats/message_actions.py",
    "routers/chats/read_state.py",
    "services/whatsapp_capabilities.py",
])
def test_messaging_flows_depend_on_the_channel_port_not_on_meta(module):
    imported = _imported_modules(BACKEND / module)

    assert not any(name.startswith("services.meta_service") for name in imported)


def test_no_router_speaks_sql():
    """Un router puede importar `db.models` para tipar lo que le inyecta una
    dependencia, pero el mecanismo de persistencia no puede asomar en HTTP: si
    una ruta atrapa IntegrityError, el servicio no levantó su error de dominio.
    """
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in (BACKEND / "routers").rglob("*.py")
        for module in _imported_modules(path)
        if module.startswith("sqlalchemy")
    }

    assert violations == set()


# Los flujos de conversación hablan con el canal; estos módulos son los únicos
# que tratan con Meta directamente, y son de administración de la cuenta
# (plantillas del catálogo, import de media, conexión de la cuenta), no de
# mandar mensajes.
META_ALLOWED = {
    "services/meta_channel.py",
    "services/template_validation.py",
    "routers/templates.py",
    "routers/webhooks/media.py",
    # Completa el embedded signup (intercambia el code, resuelve el
    # phone_number_id): conexión/onboarding de la cuenta, no envío.
    "routers/settings.py",
    # Solo consulta is_configured() para decidir el estado a mostrar en la UI
    # ("open"/"not_configured"); no manda mensajes.
    "routers/whatsapp.py",
}


def test_only_an_explicit_allow_list_talks_to_meta_directly():
    """Antes la regla nombraba a los módulos que NO podían importar
    `meta_service`, así que cualquier módulo nuevo quedaba autorizado sin que
    nadie lo decidiera. Invertida, agregar un consumidor es una decisión."""
    culpables = {
        path.relative_to(BACKEND).as_posix()
        for base in ("services", "routers")
        for path in (BACKEND / base).rglob("*.py")
        if any(name.startswith("services.meta_service") for name in _imported_modules(path))
        and path.relative_to(BACKEND).as_posix() not in META_ALLOWED
    }

    assert culpables == set()


def test_the_allow_list_has_no_leftovers():
    """Un módulo que dejó de hablar con Meta tiene que salir de la lista, o
    deja de ser una decisión y pasa a ser historia."""
    sobrantes = {
        entry for entry in META_ALLOWED
        if not any(
            name.startswith("services.meta_service")
            for name in _imported_modules(BACKEND / entry)
        )
    }

    assert sobrantes == set()


def test_only_the_outbox_writes_to_the_outbox():
    """`enqueue_messages` resuelve el message_type desde OUTBOUND_KINDS, el
    touch del lead, la deduplicación y el aviso al worker. Quien arme la fila
    por su cuenta se pierde todo eso en silencio."""
    culpables = set()
    for path in (BACKEND / "services").rglob("*.py"):
        if path.name == "message_outbox.py":
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "MessageOutbox":
                culpables.add(str(path.relative_to(BACKEND)))

    assert culpables == set()


def test_the_capabilities_module_names_no_provider_at_all():
    """Existe para que el resto no sepa qué canal está conectado: si nombra a
    uno, la respuesta miente en cuanto se conecte otro."""
    imported = _imported_modules(BACKEND / "services/whatsapp_capabilities.py")
    proveedores = {"services.meta_service", "services.evolution_service"}

    assert not {name for name in imported if name in proveedores}


def test_automation_modules_never_import_their_facade():
    violations = {
        str(path.relative_to(BACKEND))
        for path in (BACKEND / "services" / "automations").glob("*.py")
        if any(name.startswith("services.automation_service") for name in _imported_modules(path))
    }

    assert violations == set()


def test_lead_visibility_does_not_depend_on_the_evolution_client():
    imported = _imported_modules(BACKEND / "services" / "store" / "chat_queries.py")

    assert not any(name.startswith("services.evolution_service") for name in imported)
