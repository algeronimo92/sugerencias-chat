"""Crea o reanuda un negocio aislado por schema.

Ejemplo:
    python -m scripts.provision_tenant --name "Clínica Norte" \
        --hostname norte.cliniventas.com --provider meta \
        --phone-number-id 123456789
"""

from __future__ import annotations

import argparse
import asyncio
import json

from db.session import close_engine
from services.auth_service import hash_password
from tenancy.provisioning import provision_tenant


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--provider", choices=("meta", "evolution"))
    parser.add_argument("--phone-number-id")
    parser.add_argument("--waba-id")
    parser.add_argument("--admin-email")
    parser.add_argument("--admin-password")
    parser.add_argument(
        "--setting",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="setting tenant inicial; se puede repetir",
    )
    args = parser.parse_args()

    if (args.provider or args.waba_id) and not args.phone_number_id:
        parser.error("--phone-number-id is required when configuring WhatsApp")
    if bool(args.admin_email) != bool(args.admin_password):
        parser.error("--admin-email and --admin-password must be provided together")
    initial_settings = {}
    for item in args.setting:
        key, separator, value = item.partition("=")
        if not separator or not key.strip():
            parser.error("--setting must use KEY=VALUE")
        initial_settings[key.strip()] = value
    try:
        context = await provision_tenant(
            name=args.name,
            hostname=args.hostname,
            provider=args.provider,
            phone_number_id=args.phone_number_id,
            waba_id=args.waba_id,
            initial_settings=initial_settings,
            admin_email=args.admin_email,
            admin_password_hash=(
                hash_password(args.admin_password) if args.admin_password else None
            ),
        )
        print(
            json.dumps(
                {
                    "organization_id": str(context.organization_id),
                    "hostname": context.hostname,
                    "schema_name": context.schema_name,
                    "status": "active",
                }
            )
        )
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
