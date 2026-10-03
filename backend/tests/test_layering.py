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


# Los modelos guardan valores de los enums de cada módulo (defaults y checks):
# leen solo su contrato publicado, un archivo hoja sin dependencias.
PUBLISHED_TYPES = re.compile(r"^app\.modules\.\w+\.ports\.types(\.\w+)?$")


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
        and not (package == "app/db" and PUBLISHED_TYPES.match(module))
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
    "app/modules/conversations/application/outbound.py",
    "app/modules/automations/application/actions.py",
    "app/modules/automations/application/engine.py",
    "app/modules/automations/application/deps.py",
    "app/modules/conversations/outbound_api.py",
    "app/modules/conversations/message_actions_api.py",
    "app/modules/conversations/read_state_api.py",
    "app/modules/conversations/infrastructure/outbox_worker.py",
    "app/modules/conversations/infrastructure/sql_outbox.py",
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
    owner = BACKEND / "app/modules/conversations/infrastructure/sql_outbox.py"
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
        BACKEND / "app/modules/conversations/service_window.py",
        BACKEND / "app/modules/automations/application/simulation.py",
        BACKEND / "app/modules/automations/application/flow_nodes.py",
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

# Excepción explícita: el contrato de mensajes de Meta (topes de botones,
# largos de texto y epígrafes) es parte del lenguaje del dominio de una app
# nativa de Meta. Es un JSON leído sin IO de red ni dependencias.
DOMAIN_SHARED_KERNEL = ("app.integrations.meta.contract",)


def _domain_files() -> list[Path]:
    return [path for path in MODULES.rglob("*.py") if "domain" in path.relative_to(MODULES).parts]


def test_domain_layers_depend_on_nothing_external():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _domain_files()
        for module in _imported_modules(path)
        if module.startswith(DOMAIN_FORBIDDEN) and not module.startswith(DOMAIN_SHARED_KERNEL)
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


# Módulos que solo declaran puertos (Protocol, dataclasses, errores) sin IO:
# la aplicación puede nombrarlos sin acoplarse a una implementación.
PORT_DEFINITION_MODULES = ("app.integrations.whatsapp.channel",)


def test_application_layers_only_talk_to_ports():
    violations = {
        f"{path.relative_to(BACKEND)} -> {module}"
        for path in _layer_files("application")
        for module in _imported_modules(path)
        if module.startswith(APPLICATION_FORBIDDEN)
        and not module.startswith(PORT_DEFINITION_MODULES)
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


# Los avisos por WebSocket salen de suscriptores, después del commit. Un caso
# de uso que emite su propio aviso puede anunciar algo que la transacción
# termina revirtiendo. Esta lista de transición solo puede achicarse.
REALTIME_TRANSITION: set[str] = set()


def _realtime_importers() -> set[str]:
    return {
        path.relative_to(BACKEND).as_posix()
        for base in ("app/modules", "app/integrations", "app/tenancy", "app/workers")
        for path in (BACKEND / base).rglob("*.py")
        if any(module.startswith("app.realtime") for module in _imported_modules(path))
    }


def test_only_subscribers_talk_to_the_websocket():
    offenders = {
        path for path in _realtime_importers()
        if not path.endswith("/subscribers.py") and path not in REALTIME_TRANSITION
    }
    assert offenders == set()


def test_the_realtime_transition_list_has_no_leftovers():
    assert REALTIME_TRANSITION - _realtime_importers() == set()


def test_automations_keeps_its_logic_inside_the_rings():
    """En la raíz del módulo solo quedan los adaptadores de borde: HTTP, el
    lado de lectura, los suscriptores y el contrato público. El motor vive en
    domain/application/infrastructure."""
    root = {path.name for path in (MODULES / "automations").glob("*.py")}
    assert root == {"__init__.py", "api.py", "public.py", "queries.py", "schemas.py", "subscribers.py"}


# La traducción a HTTP tiene un solo lugar: el handler de DomainError en
# bootstrap. Fuera de las rutas, los casos de uso, servicios y dependencias de
# autenticación levantan errores de dominio.
HTTP_EXCEPTION_OUTSIDE_ROUTES = {"app/bootstrap.py", "app/tenancy/dependencies.py"}


def test_only_routes_raise_http_exceptions():
    offenders = {
        path.relative_to(BACKEND).as_posix()
        for path in (BACKEND / "app").rglob("*.py")
        if not (path.name == "api.py" or path.name.endswith("_api.py"))
        and "HTTPException" in path.read_text(encoding="utf-8")
    }
    assert offenders == HTTP_EXCEPTION_OUTSIDE_ROUTES


def test_only_the_db_package_opens_sessions():
    """Toda sesión pasa por ``app.db.uow``: dentro de un caso de uso comparte
    su transacción y, fuera, confirma al salir. Abrir una a mano esquiva la
    unidad de trabajo."""
    offenders = {
        path.relative_to(BACKEND).as_posix()
        for path in (BACKEND / "app").rglob("*.py")
        if "db" != path.relative_to(BACKEND / "app").parts[0]
        and "get_sessionmaker()" in path.read_text(encoding="utf-8")
    }
    assert offenders == set()


def test_published_types_are_leaves():
    """Un ``types.py`` de módulo solo declara enums y constantes: lo importan
    los modelos de la base y el dominio de otros módulos sin arrastrar nada."""
    for path in MODULES.rglob("types.py"):
        if "ports" in path.parts:
            continue
        imported = _imported_modules(path)
        assert imported <= {"enum", "enum.StrEnum"}, (path, imported)


# Módulos CRUD planos: la API lee de *_queries.py y escribe por comandos del
# servicio, que abren la unidad de trabajo y anuncian lo que cambió. Un
# servicio que solo reenvía al repositorio es una capa vacía.
FLAT_MODULES = ("catalogs", "media", "notifications", "issue_reports", "tasks")


def test_flat_module_services_are_not_pass_throughs():
    offenders = set()
    for module in FLAT_MODULES:
        for path in (MODULES / module).glob("*service.py"):
            for node in ast.parse(path.read_text(encoding="utf-8")).body:
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                body = [s for s in node.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
                if len(body) != 1 or not isinstance(body[0], ast.Return):
                    continue
                value = body[0].value.value if isinstance(body[0].value, ast.Await) else body[0].value
                if (
                    isinstance(value, ast.Call)
                    and isinstance(value.func, ast.Attribute)
                    and isinstance(value.func.value, ast.Name)
                    and value.func.value.id.endswith("repository")
                ):
                    offenders.add(f"{path.relative_to(BACKEND)}::{node.name}")
    assert offenders == set()


# --- Propiedad de tablas --------------------------------------------------

# Cada archivo de app/db/models pertenece a un módulo. Otro módulo que importa
# esos modelos está leyendo (o escribiendo) tablas ajenas: solo se permite en
# los casos de esta lista, que solo puede achicarse.
MODEL_OWNERS = {"reports": "issue_reports", "control": "platform", "settings": "platform"}
FOREIGN_TABLES = {
    # Lado de lectura que une tablas de varios módulos en una sola consulta:
    # la bandeja, el kanban, el historial, el dashboard y el contexto de la
    # IA. Pasarlo por contratos públicos multiplicaría las consultas.
    "app/modules/conversations/chat_queries.py": {"auth", "catalogs", "leads"},
    "app/modules/conversations/chat_rows.py": {"catalogs", "leads"},
    "app/modules/conversations/inbox_queries.py": {"leads"},
    "app/modules/conversations/message_history.py": {"leads"},
    "app/modules/conversations/message_queries.py": {"leads"},
    "app/modules/leads/kanban_queries.py": {"conversations"},
    "app/modules/leads/dashboard_activity_repository.py": {"auth", "conversations"},
    "app/modules/leads/dashboard_appointments_repository.py": {"appointments", "auth"},
    "app/modules/leads/dashboard_automations_repository.py": {"auth", "automations"},
    "app/modules/leads/dashboard_leads_repository.py": {"auth"},
    "app/modules/leads/dashboard_summary_repository.py": {"appointments", "automations", "conversations", "tasks"},
    "app/modules/leads/dashboard_tags_repository.py": {"auth", "catalogs"},
    "app/modules/ai/ai_context.py": {"conversations", "leads"},
    "app/modules/ai/ai_jobs.py": {"conversations", "leads"},
    "app/modules/ai/suggestions_repository.py": {"conversations", "leads"},
    "app/modules/appointments/queries.py": {"auth", "leads"},
    "app/modules/automations/queries.py": {"auth", "leads"},
    "app/modules/tasks/queries.py": {"auth", "leads"},
    # Nombre de quien creó o modificó algo, unido en la misma consulta.
    "app/modules/catalogs/queries.py": {"auth"},
    "app/modules/catalogs/repository.py": {"auth"},
    "app/modules/catalogs/template_categories_queries.py": {"auth"},
    "app/modules/catalogs/template_queries.py": {"auth", "media"},
    "app/modules/conversations/scheduled_queries.py": {"auth"},
    "app/modules/conversations/internal_notes_repository.py": {"auth", "leads"},
    "app/modules/conversations/infrastructure/sql_scheduled.py": {"auth", "leads"},
    "app/modules/issue_reports/queries.py": {"auth"},
    "app/modules/issue_reports/repository.py": {"auth"},
    "app/modules/leads/queries.py": {"auth"},
    "app/modules/leads/assignment.py": {"auth"},
    "app/modules/leads/infrastructure/repository.py": {"auth", "catalogs"},
    "app/modules/media/media_library_queries.py": {"auth", "catalogs"},
    "app/modules/tasks/repository.py": {"auth", "leads"},
    # Integridad entre módulos que la base no puede expresar sola: si lo que
    # se guarda o se borra está referenciado del otro lado.
    "app/modules/automations/infrastructure/sql_references.py": {"auth", "catalogs", "media"},
    "app/modules/catalogs/custom_fields.py": {"leads"},
    "app/modules/catalogs/template_repository.py": {"automations"},
    "app/modules/leads/stages.py": {"automations", "catalogs"},
    "app/modules/appointments/infrastructure/repository.py": {"leads"},
    # El motor y el inbox miran el estado del lead (pausa, existencia,
    # columnas de bandeja) en la misma transacción que sus propias filas.
    "app/modules/automations/infrastructure/sql_executions.py": {"leads"},
    "app/modules/automations/infrastructure/sql_scheduling.py": {"conversations", "leads"},
    "app/modules/automations/infrastructure/worker.py": {"conversations", "leads", "tasks"},
    "app/modules/conversations/infrastructure/sql_inbox.py": {"leads"},
    # Escrituras que cruzan módulos a propósito: la fusión de dos leads
    # re-apunta las filas de los demás, y renombrar un recurso de la
    # librería renombra sus adjuntos en las plantillas.
    "app/modules/leads/infrastructure/merge.py": {"automations", "conversations", "notifications", "tasks"},
    "app/modules/media/media_library_repository.py": {"catalogs"},
    # El plan del negocio vive en el plano de control.
    "app/modules/ai/ai_access.py": {"platform"},
}


def _foreign_tables() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for path in MODULES.rglob("*.py"):
        owner = path.relative_to(MODULES).parts[0]
        for module in _imported_modules(path):
            parts = module.split(".")
            if parts[:3] != ["app", "db", "models"] or len(parts) < 4:
                continue
            table_owner = MODEL_OWNERS.get(parts[3], parts[3])
            if table_owner != owner:
                found.setdefault(path.relative_to(BACKEND).as_posix(), set()).add(table_owner)
    return found


def test_modules_only_touch_their_own_tables():
    found = _foreign_tables()
    unexpected = {
        path: tables - FOREIGN_TABLES.get(path, set())
        for path, tables in found.items()
        if tables - FOREIGN_TABLES.get(path, set())
    }
    assert unexpected == {}


def test_the_foreign_table_list_has_no_leftovers():
    found = _foreign_tables()
    leftovers = {
        path: tables - found.get(path, set())
        for path, tables in FOREIGN_TABLES.items()
        if tables - found.get(path, set())
    }
    assert leftovers == {}
