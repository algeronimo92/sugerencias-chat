"""Claves que pertenecen a la plataforma, no a un negocio.

El token que autentica a n8n y las credenciales de la app de Meta (Tech
Provider) son únicas para toda la instalación y se leen en rutas que corren
*antes* de resolver el tenant: el challenge del webhook, la firma HMAC y la
autenticación de `/api/webhooks/*`. En multitenant `app_settings` vive dentro
del schema de cada negocio, así que en ese punto no hay ninguna tabla que
consultar y el valor sale del entorno.

En modo legacy se conserva la lectura de `app_settings`, que es donde siguen
estando estas claves en las instalaciones single-tenant. Es la misma regla que
`_require_inbound_webhook_token` ya aplicaba en el arranque.
"""

from config import settings


PLATFORM_KEYS = frozenset(
    {
        "inbound_webhook_token",
        "meta_verify_token",
        "meta_app_secret",
    }
)


async def platform_setting(key: str) -> str:
    if key not in PLATFORM_KEYS:
        raise KeyError(f"'{key}' no es una clave de plataforma")
    value = (getattr(settings, key, "") or "").strip()
    if value or settings.multitenancy_enabled:
        return value

    from services.settings_service import get_effective

    return (await get_effective(key)).strip()
