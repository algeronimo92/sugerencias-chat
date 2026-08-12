from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from db.models import User
from services.auth_service import (
    COOKIE_NAME,
    DEVICE_COOKIE_NAME,
    clear_auth_cookies,
    clear_device_cookie,
    get_current_user,
    set_device_cookie,
    set_session_cookie,
    verify_password,
)
from services.db_service import get_user_by_email
from services.session_service import (
    PinInvalidError,
    PinLockedError,
    authenticate_pin,
    configure_pin,
    create_session,
    describe_device,
    forget_trusted_device,
    list_user_sessions,
    pin_status,
    register_trusted_device,
    remove_pin,
    revoke_all_for_user,
    revoke_session_token,
    revoke_user_session,
    valid_pin,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str
    remember_device: bool = True


class PinLoginRequest(BaseModel):
    pin: str


class PinSetupRequest(BaseModel):
    pin: str
    current_password: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str


class PinStatusOut(BaseModel):
    available: bool
    user_name: str | None = None
    masked_email: str | None = None
    device_name: str | None = None
    locked_seconds: int = 0


class SessionOut(BaseModel):
    id: str
    device_name: str
    auth_method: str
    current: bool
    created_at: datetime
    last_used_at: datetime
    absolute_expires_at: datetime


def _to_user_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name, role=user.role)


@router.post("/login", response_model=UserOut)
async def login(body: LoginRequest, response: Response, request: Request):
    user = await get_user_by_email(body.email.strip().lower())
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    device_name = describe_device(request.headers.get("user-agent"))
    trusted = None
    if body.remember_device:
        trusted = await register_trusted_device(
            user.id,
            current_token=request.cookies.get(DEVICE_COOKIE_NAME),
            device_name=device_name,
        )
        set_device_cookie(response, request, trusted.token, trusted.expires_at)
    else:
        existing_device_token = request.cookies.get(DEVICE_COOKIE_NAME)
        if existing_device_token:
            await forget_trusted_device(user.id, existing_device_token)
            clear_device_cookie(response, request)

    auth_session = await create_session(
        user.id,
        persistent=body.remember_device,
        auth_method="password",
        device_name=device_name,
        trusted_device_id=trusted.device_id if trusted else None,
    )
    set_session_cookie(
        response,
        request,
        auth_session.token,
        persistent=auth_session.persistent,
        absolute_expires_at=auth_session.absolute_expires_at,
    )
    return _to_user_out(user)


@router.get("/pin/status", response_model=PinStatusOut)
async def get_pin_status(request: Request):
    return await pin_status(request.cookies.get(DEVICE_COOKIE_NAME))


@router.post("/pin/login", response_model=UserOut)
async def pin_login(body: PinLoginRequest, response: Response, request: Request):
    try:
        user, trusted = await authenticate_pin(
            request.cookies.get(DEVICE_COOKIE_NAME), body.pin
        )
    except PinLockedError as exc:
        raise HTTPException(
            status_code=423,
            detail="Demasiados intentos. Esperá antes de volver a probar.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )
    except PinInvalidError:
        raise HTTPException(status_code=401, detail="PIN incorrecto")

    auth_session = await create_session(
        user.id,
        persistent=True,
        auth_method="pin",
        device_name=describe_device(request.headers.get("user-agent")),
        trusted_device_id=trusted.device_id,
    )
    set_device_cookie(response, request, trusted.token, trusted.expires_at)
    set_session_cookie(
        response,
        request,
        auth_session.token,
        persistent=True,
        absolute_expires_at=auth_session.absolute_expires_at,
    )
    return _to_user_out(user)


@router.post("/pin/setup", response_model=PinStatusOut)
async def setup_pin(
    body: PinSetupRequest,
    response: Response,
    request: Request,
    user: User = Depends(get_current_user),
):
    if not valid_pin(body.pin):
        raise HTTPException(status_code=400, detail="El PIN debe tener exactamente 6 dígitos")
    if not verify_password(body.current_password, user.password_hash):
        # 400, no 401: la sesión sigue siendo válida. El interceptor global
        # interpreta 401 como "sesión vencida" y mandaría al usuario al login.
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
    trusted = await configure_pin(
        user.id,
        device_token=request.cookies.get(DEVICE_COOKIE_NAME),
        pin=body.pin,
        device_name=describe_device(request.headers.get("user-agent")),
    )
    set_device_cookie(response, request, trusted.token, trusted.expires_at)
    return await pin_status(trusted.token)


@router.delete("/pin", status_code=204)
async def delete_pin(
    response: Response,
    request: Request,
    user: User = Depends(get_current_user),
):
    await remove_pin(user.id, request.cookies.get(DEVICE_COOKIE_NAME))
    clear_device_cookie(response, request)


@router.get("/sessions", response_model=list[SessionOut])
async def sessions(request: Request, user: User = Depends(get_current_user)):
    return await list_user_sessions(user.id, request.state.auth_session_id)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    response: Response,
    request: Request,
    user: User = Depends(get_current_user),
):
    removed = await revoke_user_session(user.id, session_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    if session_id == request.state.auth_session_id:
        clear_auth_cookies(response, request)


@router.post("/logout")
async def logout(response: Response, request: Request):
    await revoke_session_token(request.cookies.get(COOKIE_NAME))
    clear_auth_cookies(response, request)
    return {"status": "ok"}


@router.post("/logout-all")
async def logout_all(
    response: Response,
    request: Request,
    user: User = Depends(get_current_user),
):
    await revoke_all_for_user(user.id, include_devices=True)
    clear_auth_cookies(response, request, include_device=True)
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return _to_user_out(user)
