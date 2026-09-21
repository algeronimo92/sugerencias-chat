"""Crea (o actualiza) un operador del panel de plataforma.

Es el arranque en frío del panel: sin ningún `platform_users`, nadie puede
entrar, y la creación no puede hacerse desde el propio panel. Los superadmins
posteriores se pueden dar de alta desde acá también.

Ejemplo:
    python -m scripts.create_platform_user --email ops@cliniventas.com \
        --name "Gerson" --password '<contraseña>'
"""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone

from sqlalchemy import select

from db.models import PlatformUser
from db.session import close_engine, control_session
from services.auth_service import hash_password


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="si el correo ya existe, actualiza su contraseña en vez de fallar",
    )
    args = parser.parse_args()

    if len(args.password) < 8:
        parser.error("la contraseña debe tener al menos 8 caracteres")

    email = args.email.strip().lower()
    try:
        async with control_session() as session:
            existing = (
                await session.execute(
                    select(PlatformUser).where(PlatformUser.email == email)
                )
            ).scalars().first()
            if existing is not None and not args.reset_password:
                raise SystemExit(
                    f"{email} ya existe; usá --reset-password para cambiarle la contraseña"
                )
            if existing is not None:
                existing.password_hash = hash_password(args.password)
                existing.name = args.name
                existing.is_active = True
                accion = "actualizado"
            else:
                session.add(
                    PlatformUser(
                        email=email,
                        name=args.name,
                        password_hash=hash_password(args.password),
                        created_at=datetime.now(timezone.utc),
                    )
                )
                accion = "creado"
        print(json.dumps({"email": email, "estado": accion}))
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
