"""Registro declarativo unico para los modelos de control y tenant."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
