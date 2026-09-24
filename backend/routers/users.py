from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.models import User
from services.account_actions import invite_user, request_password_reset
from services.auth_service import invalidate_user_cache, require_admin
from services.db_service import (
    EmailAlreadyExistsError,
    LastAdminError,
    get_user_by_id,
    list_users,
    update_user,
)
from services.email_service import EmailDeliveryError, EmailNotConfiguredError
from services.session_service import revoke_all_for_user

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])


class UserItem(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool


class CreateUserRequest(BaseModel):
    email: str
    name: str
    role: str = "vendedor"


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None


@router.get("", response_model=list[UserItem])
async def get_users():
    return await list_users()


@router.post("", response_model=UserItem, status_code=201)
async def add_user(body: CreateUserRequest):
    if body.role not in ("admin", "vendedor"):
        raise HTTPException(status_code=400, detail="Rol inválido")
    if not body.email.strip() or not body.name.strip():
        raise HTTPException(status_code=400, detail="Nombre y correo son obligatorios")

    try:
        user = await invite_user(
            email=body.email.strip().lower(),
            name=body.name.strip(),
            role=body.role,
        )
        invalidate_user_cache(user["id"])
        return user
    except EmailAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese email")
    except (EmailNotConfiguredError, EmailDeliveryError):
        raise HTTPException(
            status_code=503,
            detail="No se pudo enviar la invitación. Revisa la configuración de correo.",
        )


@router.patch("/{user_id}", response_model=UserItem)
async def patch_user(user_id: int, body: UpdateUserRequest, current: User = Depends(require_admin)):
    if body.role is not None and body.role not in ("admin", "vendedor"):
        raise HTTPException(status_code=400, detail="Rol inválido")

    if user_id == current.id and (body.role == "vendedor" or body.is_active is False):
        raise HTTPException(status_code=400, detail="No podés quitarte a vos mismo el acceso de administrador")

    values = body.model_dump(exclude_unset=True)
    try:
        user = await update_user(user_id, values)
    except LastAdminError:
        raise HTTPException(status_code=400, detail="No podés dejar la cuenta sin ningún administrador activo")

    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    invalidate_user_cache(user_id)
    if body.is_active is False:
        await revoke_all_for_user(user_id, include_devices=True)
    return user


@router.post("/{user_id}/send-password-reset", status_code=202)
async def send_password_reset(user_id: int):
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    await request_password_reset(user.email)
    return {"status": "ok"}


@router.post("/{user_id}/resend-invitation", response_model=UserItem)
async def resend_invitation(user_id: int):
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.is_active:
        raise HTTPException(status_code=409, detail="El usuario ya activó su cuenta")
    try:
        return await invite_user(email=user.email, name=user.name, role=user.role)
    except (EmailNotConfiguredError, EmailDeliveryError):
        raise HTTPException(
            status_code=503,
            detail="No se pudo reenviar la invitación. Revisa la configuración de correo.",
        )
