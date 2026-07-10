from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.models import User
from services.auth_service import hash_password, require_admin
from services.db_service import (
    EmailAlreadyExistsError,
    LastAdminError,
    create_user,
    list_users,
    set_user_password,
    update_user,
)

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
    password: str
    role: str = "vendedor"


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.get("", response_model=list[UserItem])
async def get_users():
    return await list_users()


@router.post("", response_model=UserItem, status_code=201)
async def add_user(body: CreateUserRequest):
    if body.role not in ("admin", "vendedor"):
        raise HTTPException(status_code=400, detail="Rol inválido")
    if not body.password:
        raise HTTPException(status_code=400, detail="La contraseña no puede estar vacía")

    try:
        return await create_user(
            email=body.email.strip().lower(),
            name=body.name.strip(),
            password_hash=hash_password(body.password),
            role=body.role,
        )
    except EmailAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese email")


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
    return user


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: int, body: ResetPasswordRequest):
    if not body.new_password:
        raise HTTPException(status_code=400, detail="La contraseña no puede estar vacía")

    ok = await set_user_password(user_id, hash_password(body.new_password))
    if not ok:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"status": "ok"}
