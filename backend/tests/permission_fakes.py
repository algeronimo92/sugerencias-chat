"""Doble de la matriz de permisos, sin base.

Reemplaza la lectura de ``role_permissions`` y el respaldo que usa ``can``
con usuarios de prueba que no pasaron por ``get_current_user`` (los
``SimpleNamespace`` de los tests), para que ambos digan lo mismo.
"""

from unittest.mock import AsyncMock

from app.modules.auth import permissions, roles_service
from app.modules.auth.permissions import DEFAULT_ROLE_PERMISSIONS, Permission
from app.modules.auth.types import UserRole


def use_role_matrix(monkeypatch, *, sellers_see_all: bool = True, **overrides: set[str]) -> dict[str, frozenset[str]]:
    """Matriz por defecto; ``sellers_see_all=False`` le quita
    ``leads.view_all`` al vendedor y ``overrides`` reemplaza la fila de un rol
    (``analista={...}``)."""
    matrix = {role: set(granted) for role, granted in DEFAULT_ROLE_PERMISSIONS.items()}
    if not sellers_see_all:
        matrix[UserRole.SELLER].discard(Permission.LEADS_VIEW_ALL)
    for role, granted in overrides.items():
        matrix[role] = set(granted)
    frozen = {role: frozenset(granted) for role, granted in matrix.items()}
    frozen[UserRole.ADMIN] = permissions.ALL_PERMISSIONS
    monkeypatch.setattr(roles_service, "role_permissions_map", AsyncMock(return_value=frozen))
    monkeypatch.setattr(permissions, "DEFAULT_ROLE_PERMISSIONS", frozen)
    return frozen
