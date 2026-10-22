"""Roles de usuario, métodos de inicio de sesión y propósitos de los enlaces
de cuenta. La base los restringe con CHECK (ver las migraciones)."""

from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    SELLER = "vendedor"


class SessionAuthMethod(StrEnum):
    PASSWORD = "password"
    PIN = "pin"


class AccountActionPurpose(StrEnum):
    INVITATION = "invitation"
    PASSWORD_RESET = "password_reset"
