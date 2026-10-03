import ast
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
MODULES = BACKEND / "app" / "modules"
INTEGRATIONS = BACKEND / "app" / "integrations"


def _imports_from_source(source: str, package: str) -> set[str]:
    """Resolve relative, module-style and symbol imports, including package initializers."""
    modules = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            if node.level:
                parent = package.split(".")[:len(package.split(".")) - node.level + 1]
                module = ".".join(parent + ([node.module] if node.module else []))
            else:
                module = node.module or ""
            # Resolve package imports through their selected child contract.
            if not (module.startswith("app.modules.") and len(module.split(".")) == 3):
                modules.add(module)
            modules.update(f"{module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
    return modules


def _imported_modules(path: Path) -> set[str]:
    package = ".".join(path.relative_to(BACKEND).parent.parts)
    return _imports_from_source(path.read_text(encoding="utf-8"), package)


def _module_python_files() -> list[Path]:
    return list(MODULES.rglob("*.py"))


def _is_layer(module: str, layer: str) -> bool:
    parts = module.split(".")
    return len(parts) >= 4 and parts[:2] == ["app", "modules"] and (
        parts[3] == layer or parts[3].endswith("_" + layer)
    )


@pytest.mark.parametrize("statement,expected", [
    ("import app.modules.leads.repository as leads", "app.modules.leads.repository"),
    ("from ..leads import repository", "app.modules.leads.repository"),
    ("from . import repository", "app.modules.ai.repository"),
    ("from app.modules import leads", "app.modules.leads"),
    ("from ..leads.repository import update_lead", "app.modules.leads.repository.update_lead"),
])
def test_import_scanner_covers_all_python_forms(statement, expected):
    assert expected in _imports_from_source(statement, "app.modules.ai")


@pytest.mark.parametrize("module,layer", [
    ("app.modules.ai.suggestions_api", "api"),
    ("app.modules.auth.session_service.resolve", "service"),
    ("app.modules.leads.kanban_repository", "repository"),
])
def test_specialized_layers_are_not_exempt(module, layer):
    assert _is_layer(module, layer)


def test_package_initializers_are_scanned():
    assert MODULES / "ai" / "__init__.py" in _module_python_files()


# Provisioning composes only these explicit owner operations, not arbitrary business internals.
PROVISIONING_IMPORTS = {
    "app.modules.auth.users_repository", "app.modules.auth.users_repository.seed_admin_if_needed",
    "app.modules.auth.session_service", "app.modules.auth.session_service.revoke_all_sessions_in_current_tenant",
    "app.modules.platform.settings_service", "app.modules.platform.settings_service.update_settings",
}


@pytest.mark.parametrize(("package", "forbidden_prefix"), [
    ("app/db", "app.modules"),
    ("app/db", "app.integrations"),
    ("app/core", "app.modules"),
    ("app/tenancy", "app.modules"),
])
def test_layers_do_not_depend_on_forbidden_packages(package, forbidden_prefix):
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in (BACKEND / package).rglob("*.py")
                for module in _imported_modules(path)
        if module.startswith(forbidden_prefix)
        and not (
            path == BACKEND / "app/tenancy/provisioning.py"
            and module in PROVISIONING_IMPORTS
        )
    }

    assert violations == set()


def test_legacy_package_trees_are_gone():
    for package in ("services", "routers", "tenancy", "db"):
        assert not list((BACKEND / package).rglob("*.py")), package


def test_architecture_packages_have_implementation():
    for package in (
        "app/core", "app/db", "app/tenancy", "app/realtime",
        "app/modules/media", "app/modules/notifications",
    ):
        assert any(path.name != "__init__.py" for path in (BACKEND / package).glob("*.py")), package


def test_http_contracts_live_with_their_domain():
    assert not (BACKEND / "models/schemas.py").exists()
    assert not list((BACKEND / "models").rglob("*.py"))
    for domain in (
        "ai", "appointments", "automations", "catalogs", "conversations",
        "issue_reports", "leads", "media", "notifications", "tasks", "auth", "platform",
    ):
        assert (MODULES / domain / "schemas.py").is_file(), domain
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in BACKEND.rglob("*.py")
        if "tests" not in path.relative_to(BACKEND).parts
        for module in _imported_modules(path)
        if module == "models" or module.startswith("models.")
    }
    assert violations == set()
@pytest.mark.parametrize("module", [
    "app/integrations/meta/outbound.py",
    "app/modules/conversations/reactions.py",
    "app/modules/automations/actions.py",
    "app/modules/automations/engine.py",
    "app/modules/automations/automation_deps.py",
    "app/modules/conversations/outbound_api.py",
    "app/modules/conversations/message_actions_api.py",
    "app/modules/conversations/read_state_api.py",
    "app/modules/conversations/message_outbox.py",
    "app/integrations/whatsapp/capabilities.py",
])
def test_messaging_flows_depend_on_the_channel_port_not_on_meta(module):
    imported = _imported_modules(BACKEND / module)

    assert not any(name.startswith("app.integrations.meta.client") for name in imported)


def test_no_router_speaks_sql():
    """Un router puede importar `app.db.models` para tipar lo que le inyecta una
    dependencia, pero el mecanismo de persistencia no puede asomar en HTTP: si
    una ruta atrapa IntegrityError, el servicio no levantó su error de dominio.
    """
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _module_python_files()
        if path.name == "api.py" or path.name.endswith("_api.py")
        for module in _imported_modules(path)
        if module.startswith("sqlalchemy")
    }

    assert violations == set()


# Los flujos de conversación hablan con el canal; estos módulos son los únicos
# que tratan con Meta directamente, y son de administración de la cuenta o de
# recepción (plantillas del catálogo, adjuntos entrantes, conexión de la
# cuenta), no de mandar mensajes.
META_ALLOWED = {
    "app/integrations/meta/channel.py",
    "app/modules/catalogs/template_validation.py",
    "app/modules/catalogs/templates_api.py",
    # Ingesta del webhook: baja los adjuntos entrantes y la plantilla completa
    # cuando Meta avisa un cambio. No manda mensajes.
    "app/integrations/meta_webhook/processor.py",
    # Completa el embedded signup (intercambia el code, resuelve el
    # phone_number_id): conexión/onboarding de la cuenta, no envío.
    "app/modules/platform/settings_api.py",
    # Solo consulta is_configured() para decidir el estado a mostrar en la UI
    # ("open"/"not_configured"); no manda mensajes.
    "app/modules/platform/whatsapp_api.py",
}


def test_only_an_explicit_allow_list_talks_to_meta_directly():
    """Antes la regla nombraba a los módulos que NO podían importar
    `meta_service`, así que cualquier módulo nuevo quedaba autorizado sin que
    nadie lo decidiera. Invertida, agregar un consumidor es una decisión."""
    culpables = {
        path.relative_to(BACKEND).as_posix()
        for base in ("app/modules", "app/integrations")
        for path in (BACKEND / base).rglob("*.py")
        if any(name.startswith("app.integrations.meta.client") for name in _imported_modules(path))
        and path.relative_to(BACKEND).as_posix() not in META_ALLOWED
    }

    assert culpables == set()


def test_the_allow_list_has_no_leftovers():
    """Un módulo que dejó de hablar con Meta tiene que salir de la lista, o
    deja de ser una decisión y pasa a ser historia."""
    sobrantes = {
        entry for entry in META_ALLOWED
        if not any(
            name.startswith("app.integrations.meta.client")
            for name in _imported_modules(BACKEND / entry)
        )
    }

    assert sobrantes == set()


def test_only_the_outbox_writes_to_the_outbox():
    """`enqueue_messages` resuelve el message_type desde OUTBOUND_KINDS, el
    touch del lead, la deduplicación y el aviso al worker. Quien arme la fila
    por su cuenta se pierde todo eso en silencio."""
    culpables = set()
    owner = BACKEND / "app/modules/conversations/message_outbox.py"
    for base in ("app/modules", "app/integrations"):
        for path in (BACKEND / base).rglob("*.py"):
            if path == owner:
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "MessageOutbox":
                    culpables.add(str(path.relative_to(BACKEND)))

    assert culpables == set()


def test_conversation_consumers_do_not_import_queries_through_db_service():
    """Las consultas de conversación no atraviesan la antigua fachada."""
    consumers = [
        * (BACKEND / "app/modules/conversations").rglob("*.py"),
        * (BACKEND / "app/integrations/meta_webhook").rglob("*.py"),
        BACKEND / "app/modules/conversations/reactions.py",
        BACKEND / "app/modules/conversations/service_window.py",
        BACKEND / "app/modules/automations/simulation.py",
        BACKEND / "app/modules/automations/flow_nodes.py",
        BACKEND / "app/bootstrap.py",
    ]
    violations = {
        str(path.relative_to(BACKEND))
        for path in consumers
        if "services.db_service" in _imported_modules(path)
    }
    assert violations == set()


def test_the_capabilities_module_names_no_provider_at_all():
    """Existe para que el resto no sepa qué canal está conectado: si nombra a
    uno, la respuesta miente en cuanto se conecte otro."""
    imported = _imported_modules(BACKEND / "app/integrations/whatsapp/capabilities.py")
    proveedores = {"app.integrations.meta.client"}

    assert not {name for name in imported if name in proveedores}


def test_automation_modules_never_import_their_facade():
    violations = {
        str(path.relative_to(BACKEND))
        for path in (BACKEND / "app" / "modules" / "automations").glob("*.py")
        if any(name.startswith("services.automation_service") for name in _imported_modules(path))
    }

    assert violations == set()


def test_new_modules_do_not_depend_on_legacy_facades_or_bootstrap():
    """La migración no puede recrear los dos puntos globales de acoplamiento.

    Un módulo temporalmente puede usar un adaptador heredado concreto, pero no
    las fachadas que reexportan dominios enteros. Tampoco compone la app: eso
    pertenece a ``app.bootstrap`` cuando se introduzca en una fase posterior.
    """

    forbidden = (
        "main",
        "app.bootstrap",
        "services",
        "routers",
        "tenancy",
        "db",
    )
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _module_python_files()
        for module in _imported_modules(path)
        if module.startswith(forbidden)
    }
    assert violations == set()


def test_new_module_api_files_do_not_speak_sql():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _module_python_files()
        if path.name == "api.py" or path.name.endswith("_api.py")
        for module in _imported_modules(path)
        if module.startswith("sqlalchemy")
    }
    assert violations == set()


def test_new_module_services_and_repositories_keep_directional_dependencies():
    violations = set()
    for path in _module_python_files():
        imported = _imported_modules(path)
        if path.name == "service.py" or path.name.endswith("_service.py"):
            for module in imported:
                if _is_layer(module, "api") or module.startswith("sqlalchemy") or module.startswith("app.db.session"):
                    violations.add(f"{path.relative_to(BACKEND)} -> {module}")
        if path.name == "repository.py" or path.name.endswith("_repository.py"):
            for module in imported:
                if _is_layer(module, "api") or _is_layer(module, "service") or module.startswith(("app.realtime", "fastapi")):
                    violations.add(f"{path.relative_to(BACKEND)} -> {module}")
    assert violations == set()


def test_http_calls_use_cases_not_repositories_and_owns_no_dtos():
    violations = set()
    for path in _module_python_files():
        if path.name != "api.py" and not path.name.endswith("_api.py"):
            continue
        for module in _imported_modules(path):
            if _is_layer(module, "repository"):
                violations.add(f"{path.relative_to(BACKEND)} -> {module}")
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ClassDef) and any(isinstance(base, ast.Name) and base.id == "BaseModel" for base in node.bases):
                violations.add(f"{path.relative_to(BACKEND)} declares HTTP DTO {node.name}")
    assert violations == set()


def test_integrations_do_not_depend_on_module_http_apis():
    if not INTEGRATIONS.exists():
        return
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in INTEGRATIONS.rglob("*.py")
        for module in _imported_modules(path)
        if _is_layer(module, "api")
    }
    assert violations == set()


def test_integrations_and_workers_use_owner_operation_contracts():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for base in (INTEGRATIONS, BACKEND / "app/workers")
        for path in base.rglob("*.py")
        for module in _imported_modules(path)
        if len(module.split(".")) >= 3 and module.startswith("app.modules.")
        and (len(module.split(".")) == 3 or module.split(".")[3] not in {"ports", "public", "schemas"})
    }
    assert violations == set()


def test_cross_domain_imports_use_explicit_contracts_without_exceptions():
    violations = set()
    for path in _module_python_files():
        owner = path.relative_to(MODULES).parts[0]
        for module in _imported_modules(path):
            parts = module.split(".")
            if len(parts) < 3 or parts[:2] != ["app", "modules"] or parts[2] == owner:
                continue
            if len(parts) == 3 or parts[3] not in {"public", "schemas", "ports"}:
                violations.add(f"{path.relative_to(BACKEND)} -> {module}")
    assert violations == set()


def test_operation_ports_are_small_explicit_owner_contracts():
    for path in MODULES.glob("*/ports/*.py"):
        if path.name == "__init__.py":
            continue
        owner = path.relative_to(MODULES).parts[0]
        tree = ast.parse(path.read_text(encoding="utf-8"))
        exports = [ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in n.targets)]
        assert len(exports) == 1 and exports[0], path
        imports = [n for n in tree.body if isinstance(n, ast.ImportFrom)]
        assert imports and all(n.module.startswith(f"app.modules.{owner}.") and not _is_layer(n.module, "api") for n in imports), path
        names = {alias.asname or alias.name for n in imports for alias in n.names}
        assert "*" not in names and names == set(exports[0]), path


def test_product_code_no_longer_imports_retired_packages():
    forbidden = ("services", "routers", "tenancy", "db")
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in BACKEND.rglob("*.py")
        if "tests" not in path.relative_to(BACKEND).parts
        for module in _imported_modules(path)
        if any(module == root or module.startswith(f"{root}.") for root in forbidden)
    }
    assert violations == set()


# --- Arquitectura hexagonal ----------------------------------------------

# El dominio no conoce persistencia, HTTP, tiempo real ni proveedores: solo
# reglas. Lo que necesite de afuera lo recibe por un puerto.
DOMAIN_FORBIDDEN = ("sqlalchemy", "fastapi", "starlette", "httpx", "app.db", "app.realtime", "app.integrations")


def _domain_files() -> list[Path]:
    return [path for path in MODULES.rglob("*.py") if "domain" in path.relative_to(MODULES).parts]


def test_domain_layers_depend_on_nothing_external():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _domain_files()
        for module in _imported_modules(path)
        if module.startswith(DOMAIN_FORBIDDEN)
    }
    assert violations == set()


def test_shared_kernel_of_events_and_errors_is_framework_free():
    for name in ("events.py", "errors.py"):
        imported = _imported_modules(BACKEND / "app" / "core" / name)
        assert not {module for module in imported if module.startswith(DOMAIN_FORBIDDEN)}, name


def test_code_on_the_unit_of_work_never_opens_sessions_by_hand():
    """Un archivo que ya participa de la unidad de trabajo no puede volver a
    abrir una sesión suelta: esa escritura quedaría fuera de la transacción del
    caso de uso (y con un lock tomado, en otra conexión)."""
    violations = set()
    for base in ("app/modules", "app/integrations", "app/workers"):
        for path in (BACKEND / base).rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            if "app.db.uow" in _imported_modules(path) or any(
                module.startswith("app.db.uow.") for module in _imported_modules(path)
            ):
                if "get_sessionmaker()" in source:
                    violations.add(str(path.relative_to(BACKEND)))
    assert violations == set()


# La aplicación orquesta: habla con puertos y abre la unidad de trabajo, pero
# no conoce SQL, HTTP ni proveedores.
APPLICATION_FORBIDDEN = ("sqlalchemy", "fastapi", "starlette", "httpx", "app.db.session", "app.db.models", "app.realtime", "app.integrations")


def _layer_files(layer: str) -> list[Path]:
    return [path for path in MODULES.rglob("*.py") if layer in path.relative_to(MODULES).parts]


def test_application_layers_only_talk_to_ports():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _layer_files("application")
        for module in _imported_modules(path)
        if module.startswith(APPLICATION_FORBIDDEN)
    }
    assert violations == set()


def test_application_never_imports_its_adapters():
    """Las implementaciones se conectan en app.composition, no se importan."""
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _layer_files("application")
        for module in _imported_modules(path)
        if ".infrastructure" in module
    }
    assert violations == set()


def test_http_never_reaches_infrastructure():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _module_python_files()
        if path.name == "api.py" or path.name.endswith("_api.py")
        for module in _imported_modules(path)
        if ".infrastructure" in module
    }
    assert violations == set()


def test_the_read_side_never_writes():
    """Un ``*queries.py`` es el lado de lectura: la API lo llama directo
    porque no cambia nada. Si necesita escribir, es un comando."""
    writers = {"insert", "update", "delete"}
    violations = set()
    for path in _module_python_files():
        if not (path.name == "queries.py" or path.name.endswith("_queries.py")):
            continue
        for module in _imported_modules(path):
            if module.startswith(("sqlalchemy.", "sqlalchemy.dialects")) and module.rsplit(".", 1)[-1] in writers:
                violations.add(f"{path.relative_to(BACKEND)} -> {module}")
    assert violations == set()


def test_only_leads_moves_a_lead_between_stages():
    """La regla de cambio de etapa tiene un solo dueño. Antes el analista de IA
    tenía su propia copia y las dos divergieron."""
    pattern = re.compile(r"\bestado\s*=|\.estado\s*=|razon_perdido\s*=")
    violations = {
        str(path.relative_to(BACKEND))
        for base in ("app/modules", "app/integrations", "app/workers")
        for path in (BACKEND / base).rglob("*.py")
        if "leads" not in path.relative_to(BACKEND / base).parts[:1]
        and pattern.search(path.read_text(encoding="utf-8"))
    }
    assert violations == set()
