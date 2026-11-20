"""La matriz de permisos de cada negocio, con una caché corta por proceso.

Se consulta en cada petición autenticada y en cada aviso en tiempo real (a
quién le llega un lead), así que no puede ir a la base cada vez. Un cambio
de la matriz la invalida acá y en las demás réplicas; el TTL cubre un aviso
perdido mientras el bus estaba caído.
"""

from __future__ import annotations

from time import monotonic

from app.db.privileges import enforcement_active
from app.db.signals import on_reconnect, signal, tell_others_soon
from app.modules.auth import roles_repository
from app.modules.auth.db_privileges import CONTROL_READ_TABLES, DB_ROLES, object_privileges_for
from app.modules.auth.permissions import ALL_PERMISSIONS, EDITABLE_ROLES, GRANTABLE_PERMISSIONS
from app.modules.auth.types import UserRole
from app.tenancy.context import get_current_tenant

ROLE_PERMISSIONS_SIGNAL = "cache:role_permissions"
CACHE_TTL_SECONDS = 30.0
ROLE_ORDER = {UserRole.ADMIN: 0, UserRole.SELLER: 1, UserRole.ANALYST: 2}

_cache: dict[str | None, tuple[float, dict[str, frozenset[str]]]] = {}


class UnknownRoleError(ValueError):
    pass


class RoleNotEditableError(ValueError):
    pass


class PermissionNotGrantableError(ValueError):
    def __init__(self, permissions: set[str]):
        super().__init__(", ".join(sorted(permissions)))
        self.permissions = permissions


def _tenant_key() -> str | None:
    context = get_current_tenant()
    return str(context.organization_id) if context else None


async def role_permissions_map() -> dict[str, frozenset[str]]:
    """Permisos de cada rol del negocio actual. ``admin`` siempre tiene todos."""
    key = _tenant_key()
    cached = _cache.get(key)
    if cached is not None and monotonic() < cached[0]:
        return cached[1]
    matrix = await roles_repository.load_matrix()
    matrix[UserRole.ADMIN] = ALL_PERMISSIONS
    _cache[key] = (monotonic() + CACHE_TTL_SECONDS, matrix)
    return matrix


async def permissions_for_role(role: str) -> frozenset[str]:
    return (await role_permissions_map()).get(role, frozenset())


async def roles_with_permission(permission: str) -> frozenset[str]:
    return frozenset(role for role, perms in (await role_permissions_map()).items() if permission in perms)


async def list_roles() -> list[dict]:
    matrix = await role_permissions_map()
    roles = await roles_repository.load_roles()
    return [
        {**role, "permissions": sorted(matrix.get(role["key"], frozenset()))}
        for role in sorted(roles, key=lambda role: ROLE_ORDER.get(role["key"], 99))
    ]


async def set_role_permissions(role: str, permissions: set[str]) -> None:
    """Reemplaza la fila de ``role`` en la matriz. Solo roles editables y
    permisos que se pueden dar a alguien que no es admin."""
    if role not in EDITABLE_ROLES:
        if role == UserRole.ADMIN:
            raise RoleNotEditableError(role)
        raise UnknownRoleError(role)
    rejected = permissions - GRANTABLE_PERMISSIONS
    if rejected:
        raise PermissionNotGrantableError(rejected)
    missing = permissions - await roles_repository.known_permissions()
    if missing:
        # El catálogo del código va por delante de la base: falta la
        # migración que inserta el permiso nuevo.
        raise PermissionNotGrantableError(missing)
    await roles_repository.replace_role_permissions(role, permissions)
    invalidate_role_permissions_cache()
    await sync_db_privileges()


def desired_db_grants(matrix: dict[str, frozenset[str]]) -> dict[str, dict[str, frozenset[str]]]:
    """Privilegios de objeto de cada rol de base del negocio (por sufijo) según su matriz."""
    return {
        DB_ROLES[role]: object_privileges_for(role, matrix.get(role, frozenset()))
        for role in DB_ROLES
    }


async def sync_db_privileges() -> bool:
    """Crea los roles de base del negocio actual si faltan y lleva sus GRANT a
    lo que dice su matriz. Sin negocio activo (plano de control) no hay schema
    que tocar; sin CREATEROLE no hay roles y devuelve False."""
    context = get_current_tenant()
    if context is None:
        return False
    return await roles_repository.apply_db_grants(
        context.schema_name, desired_db_grants(await role_permissions_map()), CONTROL_READ_TABLES,
    )


async def describe_db_privileges() -> list[dict]:
    context = get_current_tenant()
    if context is None:
        return []
    return await roles_repository.describe_db_privileges(context.schema_name)


async def set_role_permission(role: str, permission: str, *, granted: bool) -> None:
    current = set(await permissions_for_role(role))
    if granted:
        current.add(permission)
    else:
        current.discard(permission)
    await set_role_permissions(role, current)


def invalidate_role_permissions_cache() -> None:
    key = _tenant_key()
    _cache.pop(key, None)
    tell_others_soon(ROLE_PERMISSIONS_SIGNAL, {"organization_id": key})


@signal(ROLE_PERMISSIONS_SIGNAL).on
async def _invalidated_elsewhere(payload: dict) -> None:
    _cache.pop(payload.get("organization_id"), None)


@on_reconnect
async def _forget_every_matrix() -> None:
    _cache.clear()
