"""De dónde salió un mensaje del negocio.

``sender`` solo dice "cliente" o "vendedor". Para el equipo eso no alcanza:
en un chat que atienden varias personas y varios flujos, una burbuja tiene
que poder decir si la mandó alguien desde la app, un flujo de automatización,
un mensaje programado o el celular del negocio. Incidente que lo motivó: una
plantilla enviada a mano era idéntica al primer envío de un flujo y nadie
pudo distinguir, mirando el chat, si el flujo había arrancado.

No hay una columna que diga el origen: se deriva de tres señales que ya se
guardan al encolar. La clave de dedupe del outbox la fija quien encola
(``automation:<ejecución>:…`` los flujos, ``scheduled:<id>`` los programados),
``sent_by_user_id`` la llenan los envíos de la app, y un mensaje del negocio
sin fila de outbox no salió por la app: llegó como eco del celular por el
webhook.
"""

from __future__ import annotations

from enum import StrEnum

from app.modules.conversations.domain.types import MessageSender

# Prefijos que ponen quienes encolan; están fijados por tests de cada lado
# (test_automation_actions para los flujos, scheduling para programados).
AUTOMATION_KEY_PREFIX = "automation:"
SCHEDULED_KEY_PREFIX = "scheduled:"


class MessageOriginKind(StrEnum):
    # Una persona lo mandó desde la app (chat, plantilla, reenvío).
    USER = "user"
    # Lo mandó una ejecución de flujo o regla de automatización.
    AUTOMATION = "automation"
    # Un mensaje programado: lo escribió una persona, salió solo a su hora.
    SCHEDULED = "scheduled"
    # Salió sin pasar por la app: eco del celular del negocio vía webhook.
    ECHO = "echo"


def _execution_id(dedupe_key: str) -> int | None:
    # Forma: automation:<execution_id>:<posición>:<llamada>:<índice>.
    parts = dedupe_key.split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


def classify_origin(
    *,
    sender: str | None,
    sent_by_user_id: int | None,
    has_outbox: bool,
    dedupe_key: str | None,
) -> dict | None:
    """Origen de un mensaje, o ``None`` si lo escribió el cliente.

    Devuelve ``kind`` y, cuando aplica, ``user_id`` (persona a quien se le
    acredita) y ``execution_id`` (la ejecución que lo generó). El nombre de la
    persona lo agrega quien tenga acceso a usuarios.
    """
    if sender != MessageSender.SELLER:
        return None
    if dedupe_key and dedupe_key.startswith(AUTOMATION_KEY_PREFIX):
        return {
            "kind": MessageOriginKind.AUTOMATION,
            "user_id": None,
            "execution_id": _execution_id(dedupe_key),
        }
    if dedupe_key and dedupe_key.startswith(SCHEDULED_KEY_PREFIX):
        return {"kind": MessageOriginKind.SCHEDULED, "user_id": sent_by_user_id, "execution_id": None}
    if not has_outbox:
        return {"kind": MessageOriginKind.ECHO, "user_id": None, "execution_id": None}
    # Envíos de la app anteriores a sent_by_user_id quedan como "user" sin
    # persona: salieron por el outbox pero nadie quedó acreditado.
    return {"kind": MessageOriginKind.USER, "user_id": sent_by_user_id, "execution_id": None}
