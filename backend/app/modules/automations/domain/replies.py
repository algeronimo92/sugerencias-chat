"""Cómo se interpreta lo que contesta el cliente mientras un flujo espera:
qué clase de respuesta es, a qué botón corresponde y por qué rama sigue."""

from app.modules.automations.domain.types import QuestionHandle, WaitAnyConditionKind

from app.modules.automations.domain.rules import normalize_reply_text

# Meta informa que el cliente vio lo enviado con ``read``: no distingue una
# nota de voz reproducida de un mensaje leído.
SEEN_META_STATUS = "read"

# Raíces de Meta que cuentan como "el cliente mandó una foto o un archivo".
# El sticker queda fuera a propósito: es una reacción, nadie responde con uno
# a un "mandame una foto de la zona".
MEDIA_MESSAGE_TYPES = frozenset({"image", "video", "document"})

# Raíces de Meta que no son una respuesta del cliente: un aviso de sistema
# (cambio de número) no debe despertar a un flujo que espera su respuesta.
NON_REPLY_MESSAGE_TYPES = frozenset({"system"})


def classify_customer_reply(message_type: str | None) -> str | None:
    """Qué clase de respuesta es un mensaje del cliente, para decidir por qué
    rama sigue un bloque que está esperando.

    Devuelve el `kind` de la condición que satisface —`media_received` o
    `message`— o None si el evento no es una respuesta y hay que seguir
    esperando como si no hubiera llegado.
    """
    if message_type in MEDIA_MESSAGE_TYPES:
        return WaitAnyConditionKind.MEDIA_RECEIVED
    if message_type in NON_REPLY_MESSAGE_TYPES:
        return None
    return WaitAnyConditionKind.MESSAGE


def match_question_button(
    buttons: list[dict],
    reply_id: str | None,
    content: str | None,
    kind: str | None = None,
    has_media_handle: bool = False,
) -> str:
    """Resuelve a qué botón corresponde la respuesta del cliente: por el id
    que Meta devuelve en ``interactive.button_reply.id`` si tocó un botón; si
    escribió en vez de tocar, por número de posición o por el texto del botón;
    si no matchea nada, "otra respuesta".

    Una foto se resuelve antes de mirar texto y sale por su propia salida:
    9 de cada 10 llegan sin caption, así que por texto no matchea nada y
    terminaría en "otra respuesta" — que es justamente la rama del cliente
    que NO mandó lo que se le pidió. Si el flujo no conectó esa salida,
    conserva el comportamiento anterior.
    """
    if kind == WaitAnyConditionKind.MEDIA_RECEIVED and has_media_handle:
        return QuestionHandle.MEDIA
    if reply_id and any(button["id"] == reply_id for button in buttons):
        return reply_id
    normalized = normalize_reply_text(content or "")
    if normalized.isdigit():
        index = int(normalized) - 1
        if 0 <= index < len(buttons):
            return buttons[index]["id"]
    for button in buttons:
        if normalize_reply_text(button["label"]) == normalized:
            return button["id"]
    return QuestionHandle.OTHER


# Cuántos mensajes del cliente se miran por ejecución al buscar el que reanuda.
# Sólo se necesita mirar más de uno cuando los primeros no son respuestas (un
# aviso de sistema) o no satisfacen ninguna rama declarada (un "ahorita te la
# mando" en un bloque que espera únicamente la foto).
MAX_REPLIES_SCANNED = 20


def awaiting_kinds(flow_state: dict) -> set[str]:
    """Qué clases de respuesta reanudan este bloque.

    `awaiting_message: true` es el formato anterior y equivale a "cualquier
    mensaje": se sigue leyendo para que las ejecuciones que ya estaban
    esperando cuando se desplegó esto terminen sin quedarse colgadas.
    """
    awaiting = flow_state.get("awaiting")
    if isinstance(awaiting, list):
        return {kind for kind in awaiting if isinstance(kind, str)}
    return {WaitAnyConditionKind.MESSAGE} if flow_state.get("awaiting_message") else set()


def resume_branch(kind: str, awaiting: set[str]) -> str | None:
    """Por qué rama sale una respuesta ya clasificada, o None si el bloque no
    declaró ninguna que la acepte y hay que seguir esperando.

    `message` sigue siendo el cajón de sastre —una foto también es un mensaje,
    y un bloque que sólo espera "mensaje" tiene que reanudar con ella igual que
    antes—, pero pierde contra `media_received` cuando el flujo se tomó el
    trabajo de dibujar esa rama. Al revés no: un bloque que espera únicamente
    la foto NO se despierta con un "ahorita te la mando", que es justo el
    motivo por el que existe.
    """
    if kind == WaitAnyConditionKind.MEDIA_RECEIVED and WaitAnyConditionKind.MEDIA_RECEIVED in awaiting:
        return WaitAnyConditionKind.MEDIA_RECEIVED
    if WaitAnyConditionKind.MESSAGE in awaiting:
        return WaitAnyConditionKind.MESSAGE
    return None
