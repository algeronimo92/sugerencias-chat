from app.modules.auth.schemas import (LoginRequest, PinLoginRequest, PinSetupRequest, MfaStartRequest, MfaCodeRequest, MfaDisableRequest, UserOut, PinStatusOut, SessionOut, ForgotPasswordRequest, CompleteActionRequest, ActionTokenOut)
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from app.db.models.auth import User
from app.modules.auth.auth_service import (
    COOKIE_NAME,
    DEVICE_COOKIE_NAME,
    clear_auth_cookies,
    clear_device_cookie,
    get_current_user,
    set_device_cookie,
    set_session_cookie,
    verify_password,
)
from app.modules.auth.users_service import get_user_by_email
from app.modules.auth.admin_totp import (
    TotpSetupError,
    confirm_enrollment,
    disable_mfa,
    mfa_status,
    start_enrollment,
    verify_mfa,
)
from app.modules.auth.login_throttle import LoginThrottledError, clear_account_attempts, reserve_login_attempt
from app.modules.auth.account_actions import (
    INVITATION,
    PASSWORD_RESET,
    InvalidActionTokenError,
    consume_action_token,
    describe_action_token,
    request_password_reset,
)
from app.modules.auth.session_service import (
    PIN_LENGTH,
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


def _to_user_out(user: User) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name, role=user.role)


async def _reserve_mfa_attempt(user: User, request: Request, scope: str) -> None:
    try:
        await reserve_login_attempt(
            user.email.strip().lower(),
            request.client.host if request.client else "unknown",
            scope=scope,
        )
    except LoginThrottledError as exc:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos. Espera antes de volver a probar.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc


@router.post("/login", response_model=UserOut)
async def login(body: LoginRequest, response: Response, request: Request):
    email = body.email.strip().lower()
    try:
        await reserve_login_attempt(email, request.client.host if request.client else "unknown")
    except LoginThrottledError as exc:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos. Espera antes de volver a probar.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    user = await get_user_by_email(email)
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    mfa_enabled = user.role == "admin" and (await mfa_status(user.id))["enabled"]
    if mfa_enabled:
        if not body.mfa_code or not await verify_mfa(user.id, body.mfa_code):
            raise HTTPException(status_code=403, detail="Ingresa un código de verificación o recuperación válido")
    await clear_account_attempts(email)

    device_name = describe_device(request.headers.get("user-agent"))
    trusted = None
    if body.remember_device and not mfa_enabled:
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

    if user.role == "admin" and (await mfa_status(user.id))["enabled"]:
        raise HTTPException(status_code=403, detail="Este administrador debe ingresar con contraseña y código de verificación")

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
    if user.role == "admin" and (await mfa_status(user.id))["enabled"]:
        raise HTTPException(status_code=409, detail="El PIN no está disponible cuando la verificación en dos pasos está activa")
    if not valid_pin(body.pin):
        raise HTTPException(
            status_code=400, detail=f"El PIN debe tener exactamente {PIN_LENGTH} dígitos"
        )
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


@router.get("/mfa/status")
async def get_mfa_status(user: User = Depends(get_current_user)):
    if user.role != "admin":
        return {"enabled": False, "recovery_codes_remaining": 0}
    return await mfa_status(user.id)


@router.post("/mfa/start")
async def start_mfa(body: MfaStartRequest, request: Request, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo para administradores")
    await _reserve_mfa_attempt(user, request, "mfa_setup")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
    try:
        result = await start_enrollment(user.id, user.email)
    except TotpSetupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await clear_account_attempts(user.email.strip().lower(), scope="mfa_setup")
    return result


@router.post("/mfa/confirm")
async def confirm_mfa(body: MfaCodeRequest, response: Response, request: Request, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo para administradores")
    await _reserve_mfa_attempt(user, request, "mfa_code")
    try:
        codes = await confirm_enrollment(user.id, body.code)
    except TotpSetupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await clear_account_attempts(user.email.strip().lower(), scope="mfa_code")
    # Una sesión iniciada antes de activar 2FA no debe seguir siendo válida.
    await revoke_all_for_user(user.id, include_devices=True)
    clear_auth_cookies(response, request, include_device=True)
    return {"recovery_codes": codes}


@router.post("/mfa/disable", status_code=204)
async def remove_mfa(body: MfaDisableRequest, request: Request, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo para administradores")
    await _reserve_mfa_attempt(user, request, "mfa_code")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
    if not await disable_mfa(user.id, body.code):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
    await clear_account_attempts(user.email.strip().lower(), scope="mfa_code")


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


@router.post("/forgot-password", status_code=202)
async def forgot_password(body: ForgotPasswordRequest):
    # La respuesta es deliberadamente idéntica si el usuario no existe, está
    # desactivado, falta SMTP o el proveedor rechaza el mensaje.
    await request_password_reset(body.email)
    return {
        "message": "Si existe una cuenta activa con ese correo, recibirás un enlace para restablecerla."
    }


@router.get("/action-token/{token}", response_model=ActionTokenOut)
async def action_token(token: str):
    try:
        return await describe_action_token(token)
    except InvalidActionTokenError:
        raise HTTPException(status_code=400, detail="El enlace no es válido o ya venció")


@router.post("/accept-invitation")
async def accept_invitation(body: CompleteActionRequest):
    try:
        await consume_action_token(
            token=body.token, purpose=INVITATION, password=body.password
        )
    except InvalidActionTokenError:
        raise HTTPException(status_code=400, detail="El enlace no es válido o ya venció")
    return {"status": "ok"}


@router.post("/reset-password")
async def complete_password_reset(body: CompleteActionRequest):
    try:
        await consume_action_token(
            token=body.token, purpose=PASSWORD_RESET, password=body.password
        )
    except InvalidActionTokenError:
        raise HTTPException(status_code=400, detail="El enlace no es válido o ya venció")
    return {"status": "ok"}
