"""Comprueba el cifrado de app_settings sin imprimir claves ni valores."""

import asyncio

from sqlalchemy import func, select

from db.models import AppSetting
from db.session import close_engine, get_sessionmaker
from services.secret_cipher import ENCRYPTED_PREFIX, SecretCipherError, decrypt_secret


async def main() -> None:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(AppSetting.key, AppSetting.value).where(
                AppSetting.value.is_not(None),
                AppSetting.value != "",
            )
        )).all()
        configured = await session.scalar(
            select(func.count(AppSetting.key)).where(
                AppSetting.value.is_not(None),
                AppSetting.value != "",
            )
        ) or 0
        encrypted = await session.scalar(
            select(func.count(AppSetting.key)).where(
                AppSetting.value.like(f"{ENCRYPTED_PREFIX}%")
            )
        ) or 0
    decryptable = 0
    for key, value in rows:
        try:
            decrypt_secret(key, value)
            decryptable += 1
        except SecretCipherError:
            pass
    print(
        f"configured={configured} encrypted={encrypted} "
        f"plaintext={configured - encrypted} decryptable={decryptable} "
        f"failures={configured - decryptable}"
    )
    await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
