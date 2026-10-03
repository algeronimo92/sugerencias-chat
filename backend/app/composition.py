"""Raíz de composición compartida por la API y los workers.

Los módulos registran sus reacciones a eventos de dominio con
``app.core.events.subscribe`` al importarse. Este archivo es el único lugar
que decide qué suscriptores existen: así ningún módulo depende de que otro lo
haya importado antes, y la API y el proceso worker ven exactamente el mismo
cableado.
"""

from __future__ import annotations

import importlib

# Cada módulo que reacciona a eventos expone un ``subscribers.py``.
SUBSCRIBER_MODULES: tuple[str, ...] = ()

_registered = False


def register_subscribers() -> None:
    global _registered
    if _registered:
        return
    for name in SUBSCRIBER_MODULES:
        importlib.import_module(name)
    _registered = True
