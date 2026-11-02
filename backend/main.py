"""Entrada estable para ``uvicorn main:app``."""

from app.bootstrap import app

__all__ = ["app"]
