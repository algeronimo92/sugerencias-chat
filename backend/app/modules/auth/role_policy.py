"""Qué alcance tiene cada rol una vez autenticado.

``admin`` y ``vendedor`` operan el CRM: cada ruta decide por su cuenta si
exige admin (``require_admin``). ``analista`` existe para mirar el dashboard
y nada más: no ve chats, leads, tareas ni citas, pida lo que pida el navegador
o un cliente a mano. Por eso su permiso es una lista cerrada de lo que sí
puede pedir y ``get_current_user`` la aplica a toda petición autenticada: una
ruta nueva queda fuera de su alcance sin que nadie tenga que acordarse.
"""

from app.modules.auth.types import UserRole

# (método o "*", ruta o prefijo). Lo mínimo para sostener su sesión y pintar
# el dashboard; un prefijo cubre la ruta exacta y sus subrutas.
ANALYST_ALLOWED_ROUTES: tuple[tuple[str, str], ...] = (
    # Su propia cuenta: /me, cerrar sesión, dispositivos, PIN y contraseña.
    ("*", "/api/auth"),
    ("GET", "/api/dashboard"),
    # El embudo del dashboard nombra las etapas con el catálogo del negocio.
    ("GET", "/api/lead-stages"),
)


def route_allowed_for(role: str, method: str, path: str) -> bool:
    if role != UserRole.ANALYST:
        return True
    return any(
        allowed_method in ("*", method.upper()) and _covers(prefix, path)
        for allowed_method, prefix in ANALYST_ALLOWED_ROUTES
    )


def realtime_allowed_for(role: str) -> bool:
    """El socket de tiempo real empuja chats y notificaciones: nada que el
    analista pueda abrir."""
    return role != UserRole.ANALYST


def _covers(prefix: str, path: str) -> bool:
    # "/api/dashboard" cubre "/api/dashboard" y "/api/dashboard/x", no "/api/dashboardx".
    return path == prefix or path.startswith(prefix + "/")
