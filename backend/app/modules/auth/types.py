"""Roles de usuario, métodos de inicio de sesión y propósitos de los enlaces
de cuenta. Los roles son filas de ``roles`` (clave foránea de ``users.role``);
los demás, CHECK (ver las migraciones)."""

from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    SELLER = "vendedor"
    # Por defecto solo mira el dashboard (ver permissions.py).
    ANALYST = "analista"


class SessionAuthMethod(StrEnum):
    PASSWORD = "password"
    PIN = "pin"


class AccountActionPurpose(StrEnum):
    INVITATION = "invitation"
    PASSWORD_RESET = "password_reset"
