"""Cuerpos de los webhooks que entran desde n8n, Evolution y Meta.

Son un contrato con sistemas de afuera, distinto de los DTO de la API propia
que viven en models/schemas.py: acá los campos se documentan por su nombre en
el evento original de WhatsApp.
"""

from datetime import date
from typing import Annotated, Any

from pydantic import BaseModel, StringConstraints


class LeadTouchWebhookBody(BaseModel):
    jid: str


class NewMessageWebhookBody(BaseModel):
    wa_message_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ReactionWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje reaccionado (key.id del reaccionado, que en el
    # evento de reacción viaja aparte del id de la reacción en sí).
    target_wa_message_id: str
    # Emoji de la reacción. Vacío = el cliente quitó la reacción.
    emoji: str = ""
    # Quién reaccionó: el cliente (False) o nosotros desde un dispositivo
    # vinculado (True). Es key.fromMe del evento de reacción.
    from_me: bool = False


class MessageEditedWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje editado (el id NO cambia al editar: WhatsApp
    # manda un protocolMessage que apunta al original).
    wa_message_id: str
    text: str


class MessageEditedSecretWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje editado (targetMessageKey.id del evento).
    wa_message_id: str
    # Candidatos de JID de quien mandó la edición: puede venir como @lid o
    # @s.whatsapp.net y no hay forma de confirmar cuál usó WhatsApp para
    # derivar la clave en el cliente. Se prueban todos.
    sender_candidates: list[str]
    enc_payload: str  # base64
    enc_iv: str  # base64


class PollResultsWebhookBody(BaseModel):
    chat_id: str
    target_wa_message_id: str
    # Snapshot normalizado: [{option, voters, count}]. Nunca se reciben aquí
    # encPayload/encIv del voto cifrado.
    results: list[dict[str, Any]]
    voter_id: str | None = None
    mode: str = "snapshot"
    decrypted: bool = True


class MessageDeletedWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje eliminado (el que viaja en el protocolMessage
    # de revoke, no el id del propio aviso).
    wa_message_id: str


class OutgoingAnalysisWebhookBody(BaseModel):
    chat_id: str
    # image | video | audio (la media saliente que se analiza).
    message_type: str
    # Enriquecimiento IA ya armado por n8n: {summary, kind, model, generated_at, version}.
    analysis: dict
    # wa_message_id del eco (no matchea con el que guardó la app; se intenta igual).
    wa_message_id: str | None = None
    # Solo se usan si hay que insertar (media enviada desde el teléfono, no la app).
    content: str | None = None
    media_url: str | None = None


class OutgoingWebhookBody(BaseModel):
    chat_id: str
    message_type: str = "text"
    content: str | None = None
    wa_message_id: str | None = None
    media_url: str | None = None
    payload: dict | None = None
    source: str | None = None
    # base64 de messageContextInfo.messageSecret del eco (ver
    # services/message_edit_crypto.py) — solo viaja en mensajes de texto.
    message_secret: str | None = None


class LeadStageWebhookBody(BaseModel):
    chat_id: str
    # None = el agente no decidió etapa en esta corrida; el webhook no hace
    # nada, así n8n puede llamarlo siempre sin un nodo IF adelante.
    estado: str | None = None
    razonamiento: str | None = None


class EnsureLeadWebhookBody(BaseModel):
    chat_id: str
    ultimo_mensaje_at: str | None = None
    origen: str | None = None


class LeadAnalysisWebhookBody(BaseModel):
    """Campos del lead que escribe el agente analista de n8n. Todo opcional:
    solo se actualiza lo que el agente resolvió en esa corrida."""

    chat_id: str
    nombre: str | None = None
    telefono: str | None = None
    servicio_interes: str | None = None
    notas: str | None = None
    razon_perdido: str | None = None
    fecha_recontacto: date | None = None
    tipo_objecion: str | None = None


class LeadInboundActivityWebhookBody(BaseModel):
    """Último mensaje del chat, tal como lo veía el nodo `update lead4`."""

    chat_id: str
    ultimo_emisor: str | None = None
    ultimo_mensaje_at: str | None = None


class MetaMediaImportBody(BaseModel):
    media_id: str
    filename: str | None = None


class SaveInboundMessageWebhookBody(BaseModel):
    chat_id: str
    sender: str
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None
    status: str | None = None
    wa_message_id: str | None = None
    media_width: int | None = None
    media_height: int | None = None
    quoted_wa_message_id: str | None = None
    message_type: str | None = None
    analysis: dict | None = None
    payload: dict | None = None
    # base64 de messageContextInfo.messageSecret del mensaje ORIGINAL (ver
    # message_edited_secret_webhook más arriba).
    message_secret: str | None = None
