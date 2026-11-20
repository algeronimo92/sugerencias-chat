"""Lectura y escritura de la matriz de permisos (``roles``, ``permissions``,
``role_permissions``). Las reglas y la caché viven en ``roles_service``."""

from __future__ import annotations

from sqlalchemy import delete, func, insert, select

from app.db.models.auth import PermissionDef, Role, RolePermission, User
from app.db import privileges as db_privileges
from app.db.uow import session_scope


async def load_matrix() -> dict[str, frozenset[str]]:
    """Cada rol del negocio con sus permisos guardados (``admin`` sin filas)."""
    async with session_scope() as db:
        roles = (await db.execute(select(Role.key))).scalars().all()
        rows = (await db.execute(select(RolePermission.role, RolePermission.permission))).all()
    granted: dict[str, set[str]] = {role: set() for role in roles}
    for role, permission in rows:
        granted.setdefault(role, set()).add(permission)
    return {role: frozenset(perms) for role, perms in granted.items()}


async def load_roles() -> list[dict]:
    async with session_scope() as db:
        roles = (await db.execute(select(Role))).scalars().all()
        counts = dict((await db.execute(
            select(User.role, func.count(User.id)).where(User.is_active.is_(True)).group_by(User.role)
        )).all())
    return [
        {"key": role.key, "name": role.name, "editable": role.editable, "active_users": counts.get(role.key, 0)}
        for role in roles
    ]


async def known_permissions() -> set[str]:
    async with session_scope() as db:
        return set((await db.execute(select(PermissionDef.key))).scalars().all())


async def replace_role_permissions(role: str, permissions: set[str]) -> None:
    async with session_scope() as db:
        await db.execute(delete(RolePermission).where(RolePermission.role == role))
        if permissions:
            await db.execute(insert(RolePermission), [
                {"role": role, "permission": permission} for permission in sorted(permissions)
            ])


async def apply_db_grants(schema: str, grants: dict[str, dict[str, frozenset[str]]]) -> None:
    async with session_scope() as db:
        await db_privileges.apply_schema_grants(db, schema, grants)


async def describe_db_privileges(schema: str) -> list[dict]:
    async with session_scope() as db:
        return await db_privileges.describe_privileges(db, schema)
