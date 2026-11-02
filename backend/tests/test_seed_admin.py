"""Sembrar el primer admin es idempotente aunque dos procesos lo intenten."""

from app.modules.auth import users_repository
from app.modules.auth.errors import EmailAlreadyExistsError


async def test_seeding_twice_at_once_does_not_fail(monkeypatch):
    class Empty:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def execute(self, _stmt):
            class Result:
                def scalar_one(self):
                    return 0

            return Result()

    async def already_created(**_kwargs):
        raise EmailAlreadyExistsError("admin@example.test")

    monkeypatch.setattr(users_repository, "session_scope", Empty)
    monkeypatch.setattr(users_repository, "create_user", already_created)

    await users_repository.seed_admin_if_needed("admin@example.test", "hash")
