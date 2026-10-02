"""Domain HTTP contracts."""

from datetime import datetime
from pydantic import BaseModel, Field, field_validator

class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)
    remember_device: bool = True
    mfa_code: str | None = Field(default=None, max_length=32)

class PinLoginRequest(BaseModel):
    pin: str

class PinSetupRequest(BaseModel):
    pin: str
    current_password: str

class MfaStartRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)

class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=32)

class MfaDisableRequest(MfaCodeRequest):
    current_password: str = Field(min_length=1, max_length=1024)

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

class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

class CompleteActionRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("password")
    @classmethod
    def password_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("La contraseña no puede estar vacía")
        return value

class ActionTokenOut(BaseModel):
    purpose: str
    email: str
    name: str



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
