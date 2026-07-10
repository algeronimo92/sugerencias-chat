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
        secure=request.url.scheme == "https",
        max_age=settings.access_token_expire_hours * 3600,
        path="/",
    )
    return _to_user_out(user)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return _to_user_out(user)
