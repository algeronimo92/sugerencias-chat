"""Los eventos que se informan a Meta, armados a partir de los hechos del
CRM. Funciones puras: sin SQL ni HTTP.

Son tres y la política de datos pública los enumera (agregar un cuarto
obliga a cambiarla antes):

- ``LeadSubmitted``: el primer mensaje de un cliente que llega desde un
  anuncio. Una vez por lead, con el clic que lo originó.
- ``QualifiedLead``: la primera cita real del lead.
- ``Purchase``: una cita con adelanto, con ese monto y la moneda del negocio.
  En CliniVentas la venta es la separación de la cita (el registro de
  compras aparte se quitó). Una por cita.

Los dos últimos llevan el último clic anterior al hecho (último toque).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

LEAD_SUBMITTED = "LeadSubmitted"
QUALIFIED_LEAD = "QualifiedLead"
PURCHASE = "Purchase"
EVENT_NAMES = (LEAD_SUBMITTED, QUALIFIED_LEAD, PURCHASE)

# Meta rechaza eventos con event_time de más de 7 días atrás.
MAX_EVENT_AGE = timedelta(days=7)
# Meta acepta hasta 1000 eventos por petición.
BATCH_SIZE = 1000
# Misma escalera que se usa para reintentar envíos: 1 min, 5 min, 30 min, 2 h, 6 h.
RETRY_DELAYS = (
    timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30),
    timedelta(hours=2), timedelta(hours=6),
)

SKIP_NO_CURRENCY = "sin moneda configurada"
SKIP_TOO_OLD = "más de 7 días"

# Subcódigos del código 100 que son un bug nuestro y no se arreglan reintentando.
_DEFINITIVE_SUBCODES = {
    2804066,  # nombre de evento no admitido
    2804081,  # Purchase sin moneda
    2804131,  # dataset sin página: se mandó al píxel o con page_id
}
_TOKEN_CODE = 190


def lead_submitted_key(lead_id: str) -> str:
    return f"{lead_id}:{LEAD_SUBMITTED}"


def qualified_lead_key(lead_id: str) -> str:
    return f"{lead_id}:{QUALIFIED_LEAD}"


def purchase_key(lead_id: str, appointment_id: int) -> str:
    return f"{lead_id}:{PURCHASE}:{appointment_id}"


def purchase_data(amount: float | Decimal, currency: str) -> dict:
    """Solo importe y moneda: la política promete que no viaja qué se compró."""
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"currency": currency, "value": float(value)}


def is_too_old(event_time: datetime, now: datetime) -> bool:
    return now - event_time > MAX_EVENT_AGE


def payload(*, event_name: str, event_time: datetime, waba_id: str, ctwa_clid: str,
            custom_data: dict | None) -> dict:
    """Un evento como lo pide la API de Conversiones para mensajería."""
    event: dict = {
        "event_name": event_name,
        "event_time": int(event_time.timestamp()),
        "action_source": "business_messaging",
        "messaging_channel": "whatsapp",
        "user_data": {"whatsapp_business_account_id": waba_id, "ctwa_clid": ctwa_clid},
    }
    if custom_data:
        event["custom_data"] = {key: custom_data[key] for key in ("currency", "value") if key in custom_data}
    return event


@dataclass(frozen=True)
class Outcome:
    """Qué hacer con un evento cuyo envío falló."""

    kind: str  # "retry" | "failed" | "token"


def classify(*, status_code: int | None, code: int | None, subcode: int | None) -> Outcome:
    """Traduce el rechazo de Meta: 429, 5xx y la red se reintentan; un token
    vencido o sin permiso (190) avisa al operador; lo demás es definitivo."""
    if code == _TOKEN_CODE:
        return Outcome("token")
    if code == 100 and subcode in _DEFINITIVE_SUBCODES:
        return Outcome("failed")
    if status_code is None or status_code == 429 or status_code >= 500:
        return Outcome("retry")
    return Outcome("failed")


def next_attempt(attempts: int, now: datetime) -> datetime:
    """``attempts`` ya cuenta el intento que acaba de fallar."""
    return now + RETRY_DELAYS[min(max(attempts, 1), len(RETRY_DELAYS)) - 1]
