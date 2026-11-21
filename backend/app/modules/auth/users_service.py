"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.db.models.auth import User
from app.modules.auth import users_repository
from app.modules.auth.errors import AnalystCannotHandleCallsError
from app.modules.auth.permissions import Permission
from app.modules.auth.roles_service import permissions_for_role, roles_with_permission
from app.modules.auth.users_repository import EmailAlreadyExistsError
from app.modules.auth.users_repository import LastAdminError

async def get_user_by_email(email: str) -> User | None:
    return await users_repository.get_user_by_email(email)

async def get_user_by_id(user_id: int) -> User | None:
    return await users_repository.get_user_by_id(user_id)

async def list_users() -> list[dict]:
    return await users_repository.list_users()


async def role_handles_calls(role: str) -> bool:
    return Permission.CALLS_HANDLE in await permissions_for_role(role)


async def update_user(user_id: int, values: dict) -> dict | None:
    """El permiso de llamadas sigue al rol: pasar a alguien a un rol sin
    ``calls.handle`` se lo quita, y dárselo a quien tiene ese rol se rechaza
    con AnalystCannotHandleCallsError."""
    new_role = values.get("role")
    if new_role is not None and not await role_handles_calls(new_role):
        if values.get("can_handle_calls") is True:
            raise AnalystCannotHandleCallsError()
        values = {**values, "can_handle_calls": False}
    elif values.get("can_handle_calls") is True and new_role is None:
        user = await users_repository.get_user_by_id(user_id)
        if user is not None and not await role_handles_calls(user.role):
            raise AnalystCannotHandleCallsError()
    return await users_repository.update_user(user_id, values)


async def list_call_agents() -> list[dict]:
    """A quiénes les suenan las llamadas de WhatsApp: activos, con
    ``can_handle_calls`` y con un rol que tiene ``calls.handle``. El rol va
    porque puede tener acotados los leads que ve (leads/visibility.call_agents_for)."""
    return await users_repository.list_call_agents(await roles_with_permission(Permission.CALLS_HANDLE))
