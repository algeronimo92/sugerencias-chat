"""Llamadas de voz de WhatsApp: estados, causas y errores.

Diseño: docs/analisis/17-plan-llamadas-whatsapp.md (§4.2 y §4.9). La llamada
vive en ``conversations`` porque mueve lo mismo que un mensaje: el chat sube
en la bandeja, se fusiona con el lead y abre la ventana de 24 h.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.errors import Conflict, Forbidden, NotFound

INBOUND = "inbound"
OUTBOUND = "outbound"

DIALING = "dialing"
RINGING = "ringing"
CONNECTING = "connecting"
ACCEPTED = "accepted"
COMPLETED = "completed"
MISSED = "missed"
REJECTED = "rejected"
FAILED = "failed"

LIVE_STATUSES = frozenset({DIALING, RINGING, CONNECTING, ACCEPTED})
FINAL_STATUSES = frozenset({COMPLETED, MISSED, REJECTED, FAILED})

# Un ``connect`` que llega más tarde que esto ya no hace sonar a nadie: Meta
# da entre 30 y 60 s para atender y el cliente probablemente ya colgó.
STALE_CONNECT_SECONDS = 60
# Lo que vale el reclamo de quien pulsó Atender mientras Meta confirma.
CLAIM_SECONDS = 15
# Por debajo de esto, una llamada perdida cuenta como "colgó enseguida" y no
# se le carga al equipo.
QUICK_HANGUP_SECONDS = 5

REAPER = "reaper"


@dataclass(frozen=True)
class Cause:
    key: str
    # Quién puede resolverlo: el equipo, el dispositivo o la red de quien
    # atiende, el cliente, la cuenta de WhatsApp o el sistema.
    group: str
    label: str
    action: str


_CAUSES = (
    Cause("no_answer", "team", "Sonó y nadie atendió", "Revisa el horario de llamadas y quiénes atienden"),
    Cause("nobody_connected", "team", "No había nadie conectado", "Alguien con permiso de llamadas tiene que tener el CRM abierto"),
    Cause("all_dismissed", "team", "Todos la ignoraron", ""),
    Cause("quick_hangup", "team", "El cliente colgó enseguida", ""),
    Cause("microphone_blocked", "device", "Micrófono bloqueado o sin micrófono", "Prepara el dispositivo para llamadas"),
    Cause("no_audio", "device", "No conectó el audio", "Prueba otra red; si se repite con la misma persona, revisa su equipo"),
    Cause("dropped", "device", "Se cortó en medio de la llamada", "Prueba otra red; si se repite con la misma persona, revisa su equipo"),
    Cause("customer_no_answer", "customer", "El cliente no contestó", "Cuatro llamadas seguidas sin contestar quitan el permiso"),
    Cause("customer_rejected", "customer", "El cliente rechazó la llamada", ""),
    Cause("no_permission", "customer", "El cliente no dio permiso o ya venció", "Pídele permiso para llamarlo"),
    Cause("customer_uncallable", "customer", "El cliente no puede recibir llamadas", "Escríbele por el chat"),
    Cause("account_paused", "account", "Meta pausó las llamadas del número", "Revisa el motivo en WhatsApp Manager"),
    Cause("account_disabled", "account", "Las llamadas no están activas en el número", "Revisa la sección Llamadas en Integraciones"),
    Cause("account_limit", "account", "Se alcanzó un límite de llamadas", "Espera a que se renueve el límite"),
    Cause("late_notice", "system", "El aviso llegó tarde al CRM", "Avisa a soporte"),
    Cause("unconfirmed", "system", "Meta no confirmó la llamada", "Avisa a soporte si se repite"),
    Cause("closed_without_meta", "system", "Cerrada sin respuesta de Meta", "Avisa a soporte si se repite"),
    Cause("other", "system", "Otro", "Avisa a soporte, con el código"),
)
CAUSES = {cause.key: cause for cause in _CAUSES}

# Motivos que puede informar el navegador al colgar: lista cerrada, nunca texto libre.
BROWSER_CAUSES = frozenset({"microphone_blocked", "no_audio", "dropped"})

# Códigos de la referencia de Meta leída el 2026-11-18. Uno que no esté acá
# cae en "other" y se guarda literal: Meta agrega códigos sin avisar.
_META_CODES = {
    "138000": "account_disabled",
    "138001": "customer_uncallable",
    "138002": "account_limit",
    "138004": "no_audio",
    "138005": "account_limit",
    "138006": "no_permission",
    "138007": "unconfirmed",
    "138009": "account_limit",
    "138012": "account_limit",
    "138013": "account_disabled",
    "138014": "account_paused",
    "138015": "account_disabled",
    "138018": "account_disabled",
    "138019": "no_audio",
    "138020": "no_audio",
    "138021": "no_audio",
    "138022": "no_audio",
    "138023": "no_audio",
    "138037": "account_limit",
}


def cause_for_meta_code(code: str | int | None) -> str | None:
    """``None`` sin código; ``"other"`` con uno que el catálogo no conoce."""
    if code is None or str(code).strip() == "":
        return None
    return _META_CODES.get(str(code).strip(), "other")


def is_known_meta_code(code: str | int | None) -> bool:
    return code is not None and str(code).strip() in _META_CODES


def missed_cause(duration_ringing_seconds: float | None, *, agents_connected: bool, all_dismissed: bool) -> str:
    """Por qué se perdió una llamada que sonó y nadie atendió."""
    if duration_ringing_seconds is not None and duration_ringing_seconds < QUICK_HANGUP_SECONDS:
        return "quick_hangup"
    if all_dismissed:
        return "all_dismissed"
    if not agents_connected:
        return "nobody_connected"
    return "no_answer"


class CallNotFound(NotFound):
    code = "call_not_found"

    def __init__(self) -> None:
        super().__init__("La llamada no existe")


class CallNoLongerRinging(Conflict):
    """Otra persona la atendió o el cliente colgó."""

    code = "call_not_ringing"

    def __init__(self, detail: str = "La llamada ya no está sonando") -> None:
        super().__init__(detail)


class CallNotYours(Forbidden):
    code = "call_not_yours"

    def __init__(self) -> None:
        super().__init__("Esta llamada la atiende otra persona")


class AgentBusy(Conflict):
    code = "agent_busy"

    def __init__(self) -> None:
        super().__init__("Ya estás en otra llamada")


class CallInProgress(Conflict):
    code = "call_in_progress"

    def __init__(self) -> None:
        super().__init__("Ya hay una llamada en curso con este cliente")


class CallNotAllowed(Conflict):
    """Meta no dejó iniciar la llamada: sin permiso, límite alcanzado, etc."""

    code = "call_not_allowed"

    def __init__(self, cause: str | None) -> None:
        known = CAUSES.get(cause or "")
        super().__init__(known.label if known else "No se pudo iniciar la llamada")
        self.cause = cause


class InvalidSdp(Conflict):
    code = "invalid_sdp"

    def __init__(self) -> None:
        super().__init__("La descripción de audio del navegador no es válida")


MAX_SDP_BYTES = 20_000


def validate_sdp(sdp: str) -> str:
    """Lo mínimo para no reenviarle a Meta cualquier cosa: tamaño acotado y
    que empiece como un SDP. Meta valida el resto."""
    if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp.encode("utf-8")) > MAX_SDP_BYTES:
        raise InvalidSdp()
    return sdp
