"""Sube a la plataforma la URL y el token de n8n que quedaron en un negocio.

Antes cada negocio guardaba en su ``app_settings`` la URL del workflow de
sugerencias, la del analista y el token saliente. Ahora esos workflows son uno
solo para todos y esas claves viven en ``public.platform_settings``: este
script copia los valores del negocio indicado (el que ya tenía n8n andando) y
los borra de su schema. Nunca pisa un valor que la plataforma ya tenga.

Una instalación con multitenancy apagado no lo necesita: el arranque ya mueve
esas claves con ``migrate_legacy_platform_settings``.

Uso:
    python -m scripts.promote_ai_settings_to_platform --hostname dermicapro.cliniventas.com
    python -m scripts.promote_ai_settings_to_platform --hostname dermicapro.cliniventas.com --apply
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import delete, select

from db.models import AppSetting
from db.session import close_engine, get_sessionmaker
from services.platform_settings import (
    _raw_database_values,
    invalidate_platform_settings_cache,
    update_platform_settings,
)
from services.secret_cipher import decrypt_secret
from tenancy.context import tenant_context
from tenancy.resolver import resolve_tenant_by_hostname

KEYS = ("n8n_webhook_url", "n8n_analyst_webhook_url", "n8n_webhook_token")
SECRET_KEYS = frozenset({"n8n_webhook_token"})


def _display(key: str, value: str) -> str:
    return "(secreto)" if key in SECRET_KEYS else value


async def _tenant_values() -> dict[str, str]:
    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                select(AppSetting.key, AppSetting.value).where(AppSetting.key.in_(KEYS))
            )
        ).all()
    return {key: decrypt_secret(key, value).strip() for key, value in rows if value}


async def _delete_tenant_rows() -> None:
    async with get_sessionmaker()() as session:
        await session.execute(delete(AppSetting).where(AppSetting.key.in_(KEYS)))
        await session.commit()


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True, help="Dominio principal del negocio")
    parser.add_argument("--apply", action="store_true", help="Aplicar (sin esto solo muestra)")
    args = parser.parse_args()

    try:
        context = await resolve_tenant_by_hostname(args.hostname)
        if context is None:
            raise SystemExit(f"No hay un negocio activo con el dominio {args.hostname}")
        with tenant_context(context):
            tenant = await _tenant_values()
        platform = {key: value for key, value in (await _raw_database_values()).items() if value}

        pending: dict[str, str] = {}
        for key in KEYS:
            if key not in tenant:
                print(f"  {key}: el negocio no lo tiene")
            elif key in platform:
                print(f"  {key}: la plataforma ya tiene un valor, se conserva")
            else:
                pending[key] = tenant[key]
                print(f"  {key}: {_display(key, tenant[key])}")

        if not args.apply:
            print("Nada se modificó: repetir con --apply.")
            return 0
        if pending:
            await update_platform_settings(pending)
        if tenant:
            with tenant_context(context):
                await _delete_tenant_rows()
        invalidate_platform_settings_cache()
        print(f"Copiadas {len(pending)} claves a la plataforma; borradas del negocio.")
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
