"""Comprueba la política de app_settings sin imprimir claves ni valores."""

import asyncio

from sqlalchemy import select

from db.models import AppSetting
from db.session import close_engine, get_sessionmaker
from services.secret_cipher import SecretCipherError, decrypt_secret, is_encrypted
from services.settings_service import SETTING_DEFS


async def main() -> None:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(AppSetting.key, AppSetting.value).where(
                AppSetting.value.is_not(None),
                AppSetting.value != "",
            )
        )).all()
    definitions = {definition.key: definition for definition in SETTING_DEFS}
    counters = {
        "secret_configured": 0,
        "secret_encrypted": 0,
        "secret_plaintext": 0,
        "secret_failures": 0,
        "public_configured": 0,
        "public_plaintext": 0,
        "public_encrypted": 0,
        "public_failures": 0,
    }
    for key, value in rows:
        definition = definitions.get(key)
        if not definition:
            continue
        kind = "secret" if definition.secret else "public"
        encrypted = is_encrypted(value)
        counters[f"{kind}_configured"] += 1
        counters[f"{kind}_{'encrypted' if encrypted else 'plaintext'}"] += 1
        if encrypted:
            try:
                decrypt_secret(key, value)
            except SecretCipherError:
                counters[f"{kind}_failures"] += 1
    print(" ".join(f"{key}={value}" for key, value in counters.items()))
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
