"""Un PIN equivocado cuenta como intento aunque el login falle.

Si el contador se revirtiera junto con el error, el bloqueo por intentos no
llegaría nunca y el PIN se podría adivinar sin límite.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.models.auth import TrustedDevice, User
from app.db.uow import session_scope
from app.modules.auth.session_policies import PinInvalidError, PinLockedError
from app.modules.auth.session_repository import authenticate_pin, configure_pin
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _device_with_pin() -> tuple[str, str]:
    async with session_scope() as session:
        user = User(
            email=f"pin-{uuid4().hex[:8]}@example.test", name="Vendedora", password_hash="!",
            role="vendedor", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        user_id = user.id
    device = await configure_pin(user_id, device_token=None, pin="1234", device_name="Mostrador")
    return device.device_id, device.token


async def _attempts(device_id: str) -> tuple[int, datetime | None]:
    async with session_scope() as session:
        device = await session.scalar(select(TrustedDevice).where(TrustedDevice.id == device_id))
        return device.failed_pin_attempts, device.locked_until


async def test_a_wrong_pin_is_counted_and_the_device_locks(tenant):
    with tenant_context(tenant):
        device_id, token = await _device_with_pin()

        with pytest.raises(PinInvalidError):
            await authenticate_pin(token, "9999")
        assert (await _attempts(device_id))[0] == 1

        for _ in range(settings.pin_max_attempts - 2):
            with pytest.raises(PinInvalidError):
                await authenticate_pin(token, "9999")
        with pytest.raises(PinLockedError):
            await authenticate_pin(token, "9999")

        attempts, locked_until = await _attempts(device_id)
        assert attempts == settings.pin_max_attempts
        assert locked_until is not None
        # Bloqueado, ni el PIN correcto entra.
        with pytest.raises(PinLockedError):
            await authenticate_pin(token, "1234")


async def test_the_right_pin_resets_the_counter_and_rotates_the_token(tenant):
    with tenant_context(tenant):
        device_id, token = await _device_with_pin()
        with pytest.raises(PinInvalidError):
            await authenticate_pin(token, "9999")

        _user, device = await authenticate_pin(token, "1234")

        assert device.token != token
        assert (await _attempts(device_id))[0] == 0
