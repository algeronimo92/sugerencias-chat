"""Dependencias de identidad compartidas con otros módulos.

``User`` es el usuario autenticado que entregan ``get_current_user`` y
``require_admin``: las rutas de otros módulos lo usan para anotar la
dependencia sin tocar el modelo de auth.
"""

from app.db.models.auth import User

from app.modules.auth.auth_service import (
    cookie_is_secure,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from app.modules.auth.login_throttle import (
    LoginThrottledError,
    clear_account_attempts,
    reserve_login_attempt,
)
from app.modules.auth.users_repository import list_active_sellers
from app.modules.auth.account_actions import try_send_operational_alert
