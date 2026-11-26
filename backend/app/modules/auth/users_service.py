"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.db.models.auth import User
from app.modules.auth import users_repository
from app.modules.auth.errors import AnalystCannotHandleCallsError
from app.modules.auth.permissions import Permission
from app.modules.auth.roles_service import permissions_for_role, roles_with_permission
from app.modules.auth.users_repository import EmailAlreadyExistsError
from app.modules.auth.users_repository import LastAdminError
from app.modules.auth.types import UserRole
from app.modules.platform.ports.plan import current_plan, ensure_seat_available

async def get_user_by_email(email: str) -> User | None:
    return await users_repository.get_user_by_email(email)

async def get_user_by_id(user_id: int) -> User | None:
    return await users_repository.get_user_by_id(user_id)

async def list_users() -> list[dict]:
    return await users_repository.list_users()


def _takes_seat(role: str, *, is_active: bool, activated_at) -> bool:
    return role != UserRole.ANALYST and (is_active or activated_at is None)


async def ensure_seat_for_invite(email: str, role: str) -> None:
    """Invitar a alguien que atiende le reserva un lugar del paquete. Si ya
    tenía una invitación pendiente con ese correo, no se cuenta dos veces."""
    if role == UserRole.ANALYST or (await current_plan()).max_seats is None:
        return
    await ensure_seat_available(lambda: users_repository.count_seats(exclude_email=email))


async def ensure_seat_for_update(user_id: int, values: dict) -> None:
    """Reactivar a alguien o pasarlo de solo lectura a un rol que atiende
    ocupa un lugar más; bajar de rol o desactivar nunca se bloquea."""
    if not {"role", "is_active"} & set(values) or (await current_plan()).max_seats is None:
        return
    user = await users_repository.get_user_by_id(user_id)
    if user is None:
        return
    before = _takes_seat(user.role, is_active=user.is_active, activated_at=user.activated_at)
    after = _takes_seat(
        values.get("role") or user.role,
        is_active=values.get("is_active", user.is_active),
        activated_at=user.activated_at,
    )
    if after and not before:
        await ensure_seat_available(lambda: users_repository.count_seats(exclude_user_id=user_id))


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
    await ensure_seat_for_update(user_id, values)
    return await users_repository.update_user(user_id, values)


async def list_call_agents() -> list[dict]:
    """A quiénes les suenan las llamadas de WhatsApp: activos, con
    ``can_handle_calls`` y con un rol que tiene ``calls.handle``. El rol va
    porque puede tener acotados los leads que ve (leads/visibility.call_agents_for)."""
    return await users_repository.list_call_agents(await roles_with_permission(Permission.CALLS_HANDLE))
