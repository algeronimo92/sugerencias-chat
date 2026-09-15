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
    ("routers", "routers."),
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


@pytest.mark.parametrize("module", [
    "services/message_outbox.py",
    "services/outbound_kinds.py",
    "services/automations/actions.py",
    "services/automations/engine.py",
    "services/automation_deps.py",
    "routers/chats.py",
])
def test_messaging_flows_depend_on_the_channel_port_not_on_meta(module):
    imported = _imported_modules(BACKEND / module)

    assert not any(name.startswith("services.meta_service") for name in imported)


def test_automation_modules_never_import_their_facade():
    violations = {
        str(path.relative_to(BACKEND))
        for path in (BACKEND / "services" / "automations").glob("*.py")
        if any(name.startswith("services.automation_service") for name in _imported_modules(path))
    }

    assert violations == set()
