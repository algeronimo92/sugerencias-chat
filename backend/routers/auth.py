from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from config import settings
from db.models import User
from services.auth_service import (
    COOKIE_NAME,
    create_access_token,
    get_current_user,
    verify_password,
)
from services.db_service import get_user_by_email

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str


def _to_user_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name, role=user.role)


def _cookie_is_secure(request: Request) -> bool:
    """Decide la marca `Secure` de la cookie de sesión.

    Traefik termina TLS y nginx proxea al backend en claro, así que
    ``request.url.scheme`` vale "http" en producción y la cookie salía sin
    `Secure`. Se respeta el override explícito y, si no lo hay, se mira el
    `X-Forwarded-Proto` que pone Traefik antes de caer al esquema directo.
    """
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


@router.post("/login", response_model=UserOut)
async def login(body: LoginRequest, response: Response, request: Request):
    user = await get_user_by_email(body.email.strip().lower())
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    token = create_access_token(user.id)
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(request),
        max_age=settings.access_token_expire_hours * 3600,
        path="/",
    )
    return _to_user_out(user)


@router.post("/logout")
async def logout(response: Response, request: Request):
    # Los atributos tienen que coincidir con los del set_cookie original o el
    # navegador conserva la cookie y la sesión sigue viva tras cerrar sesión.
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(request),
    )
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return _to_user_out(user)
