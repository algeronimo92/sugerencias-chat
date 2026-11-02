"""Contrato de la etiqueta visible en la tarjeta de un lead."""

from pydantic import BaseModel


class Tag(BaseModel):
    id: int
    name: str
    color: str
    is_active: bool = True
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None
