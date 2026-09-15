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
        for path in (BACKEND / package).glob("*.py")
        for module in _imported_modules(path)
        if module.startswith(forbidden_prefix)
    }

    assert violations == set()
