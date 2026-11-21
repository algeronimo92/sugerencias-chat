"""La matriz de permisos: qué puede hacer cada rol en este negocio.

Los roles son fijos; el admin decide qué permisos tienen el vendedor y el
analista. La fila del admin y los permisos ``admin_only`` no se tocan desde
acá (ver ``permissions.py``).
"""

from fastapi import APIRouter, Depends, HTTPException

from app.modules.auth.auth_service import require_permission
from app.modules.auth.permissions import PERMISSION_INFO, Permission
from app.modules.auth.roles_service import (
    PermissionNotGrantableError,
    RoleNotEditableError,
    UnknownRoleError,
    describe_db_privileges,
    enforcement_active,
    list_roles,
    set_role_permissions,
)
from app.modules.auth.schemas import DbPrivilegesOut, RolePermissionsUpdate, RolesOut
from app.modules.auth.subscribers import role_permissions_changed

router = APIRouter(
    prefix="/api/roles", tags=["roles"], dependencies=[Depends(require_permission(Permission.USERS_MANAGE))],
)


async def _roles_out() -> dict:
    return {
        "roles": await list_roles(),
        "permissions": [
            {"key": permission.value, "group": info.group, "label": info.label, "admin_only": info.admin_only}
            for permission, info in PERMISSION_INFO.items()
        ],
    }


@router.get("", response_model=RolesOut)
async def get_roles():
    return await _roles_out()


@router.put("/{role}/permissions", response_model=RolesOut)
async def put_role_permissions(role: str, body: RolePermissionsUpdate):
    try:
        await set_role_permissions(role, set(body.permissions))
    except UnknownRoleError as exc:
        raise HTTPException(404, "Rol no encontrado") from exc
    except RoleNotEditableError as exc:
        raise HTTPException(400, "El administrador tiene siempre todos los permisos") from exc
    except PermissionNotGrantableError as exc:
        raise HTTPException(400, f"Estos permisos no se pueden dar a ese rol: {exc}") from exc
    await role_permissions_changed()
    return await _roles_out()


@router.get("/db-privileges", response_model=DbPrivilegesOut)
async def get_db_privileges():
    """Lo que PostgreSQL tiene aplicado hoy en el schema de este negocio:
    privilegios de sistema y de objeto de cada rol de base. Se lee de
    ``pg_roles`` e ``information_schema``, no de la matriz."""
    return {"enforcement_active": enforcement_active(), "roles": await describe_db_privileges()}
