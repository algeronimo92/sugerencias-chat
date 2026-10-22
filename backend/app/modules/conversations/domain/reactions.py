"""Reacciones y fijados sobre los mensajes de un chat."""

from __future__ import annotations

# WhatsApp nativo deja fijar hasta 3 mensajes por chat (y pide desfijar uno
# para agregar un cuarto); se replica el mismo límite aunque el fijado no se
# pueda mandar hacia WhatsApp.
MAX_PINNED_MESSAGES = 3


def merge_reactions(current: list[dict] | None, emoji: str, *, from_me: bool) -> list[dict] | None:
    """Una reacción por lado: reemplaza la del mismo ``from_me`` y un emoji
    vacío la quita (así WhatsApp modela quitar la reacción)."""
    reactions = [reaction for reaction in (current or []) if reaction.get("from_me") != from_me]
    if emoji:
        reactions.append({"emoji": emoji, "from_me": from_me})
    return reactions or None
