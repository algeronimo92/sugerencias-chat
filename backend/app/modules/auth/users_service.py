"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.db.models.auth import User
from app.modules.auth import users_repository
from app.modules.auth.users_repository import EmailAlreadyExistsError
from app.modules.auth.users_repository import LastAdminError

async def get_user_by_email(email: str) -> User | None:
    return await users_repository.get_user_by_email(email)

async def get_user_by_id(user_id: int) -> User | None:
    return await users_repository.get_user_by_id(user_id)

async def list_users() -> list[dict]:
    return await users_repository.list_users()

async def update_user(user_id: int, values: dict) -> dict | None:
    return await users_repository.update_user(user_id, values)
