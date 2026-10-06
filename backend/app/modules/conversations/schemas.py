"""Contratos HTTP de conversations."""

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
from app.modules.conversations.domain.types import MessageDirection, MessageOutboxStatus


class InternalNoteMentionItem(BaseModel):
    user_id: int
    user_name: str


class InternalNoteItem(BaseModel):
    id: int
    lead_id: str
    author_user_id: int
    author_name: str
    content: str
    created_at: str
    updated_at: str
    is_edited: bool = False
    mentions: list[InternalNoteMentionItem] = Field(default_factory=list)


class InternalNoteCreate(BaseModel):
    content: str
    mentioned_user_ids: list[int] = Field(default_factory=list)


class InternalNoteUpdate(BaseModel):
    content: str
    mentioned_user_ids: list[int] = Field(default_factory=list)


class Message(BaseModel):
    """Un mensaje del hilo con el contrato de Meta.

    ``message_type``/``message_subtype`` son los literales de Meta y
    ``provider_payload`` el objeto que Meta mandó o el cuerpo exacto que se le
    envió: el frontend renderiza desde ahí. Un tipo que el contrato no conoce
    llega igual, con su nombre, para que la UI muestre lo disponible.
    ``content``, ``media_url`` y ``payload`` son proyecciones del CRM.
    """

    id: int
    sender: str
    direction: MessageDirection | None = None
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None
    wa_message_id: str | None = None
    # Estado interno del envío (outbox) y el que informa Meta, por separado.
    outbox_status: MessageOutboxStatus | None = None
    meta_status: str | None = None
    # Último evento de estado completo de Meta (errores, pricing, conversation).
    status_payload: dict | None = None
    message_type: str | None = None
    message_subtype: str | None = None
    provider_payload: dict | None = None
    # Enriquecimiento IA del adjunto (descripción/transcripción/OCR). Se sirve
    # aparte para mostrarlo bajo demanda, no dentro de la burbuja.
    analysis: dict | None = None
    # Proyección del CRM: lo que el cuerpo de Meta no trae (datos de plantilla,
    # reenviado, álbum, imagen de anuncio rehospedada).
    payload: dict | None = None
    # Reacciones sobre este mensaje (badge estilo WhatsApp), derivadas de los
    # eventos de reacción: lista de {emoji, from_me}. None si nadie reaccionó.
    reactions: list[dict] | None = None
    edited_at: str | None = None
    # Eliminado para todos (histórico). Con valor, el resto de los campos de
    # contenido vienen vacíos y el hilo pinta la lápida.
    deleted_at: str | None = None
    # Dimensiones de la imagen adjunta: el frontend reserva el espacio exacto
    # antes de que cargue, para que la conversación no se mueva.
    media_width: int | None = None
    media_height: int | None = None
    # Mensaje citado, ya resuelto a la fila local. Viene en None cuando el
    # mensaje no responde a nada o el citado no está en nuestra base.
    quoted_message_id: int | None = None
    quoted_sender: str | None = None
    quoted_content: str | None = None
    quoted_message_type: str | None = None
    # Fijado nativo del CRM: no existe forma de replicarlo hacia WhatsApp.
    pinned_at: str | None = None
    # Motivo real de un envío que el outbox dio por fallido (su last_error).
    error_detail: str | None = None


class MessagePage(BaseModel):
    items: list[Message]
    has_more: bool


class PinnedMessagesResponse(BaseModel):
    items: list[Message]


class ScheduledMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    scheduled_at: datetime


class ScheduledMessageItem(BaseModel):
    id: int
    lead_id: str
    text: str
    scheduled_at: str
    status: Literal["scheduled", "processing", "queued", "sent", "failed", "cancelled"]
    created_by_user_id: int
    created_by_user_name: str
    queued_message_id: int | None = None
    error: str | None = None
    created_at: str


class CustomerServiceWindow(BaseModel):
    is_open: bool
    last_customer_message_at: str | None = None
    expires_at: str | None = None
    seconds_remaining: int = 0


class SendMessageRequest(BaseModel):
    text: str
    # Id local del mensaje al que se responde (cita estilo WhatsApp).
    reply_to_message_id: int | None = Field(default=None, ge=1)


class SendMediaRequest(BaseModel):
    content_type: str
    data_base64: str
    filename: str | None = None
    # Epígrafe (el texto que va debajo de la imagen/video), como en WhatsApp.
    caption: str | None = None
    reply_to_message_id: int | None = Field(default=None, ge=1)
    # Id opaco (lo genera el frontend) que comparten varias fotos/videos
    # elegidos juntos en el mismo picker: agrupa el hilo del CRM en grilla sin
    # depender del heurístico de tiempo, ver mediaGroups.ts. Solo se guarda,
    # no lo interpreta el backend — WhatsApp no tiene noción de álbum saliente.
    album_id: str | None = Field(default=None, max_length=64)


class SendLocationRequest(BaseModel):
    latitude: float
    longitude: float
    reply_to_message_id: int | None = Field(default=None, ge=1)


class ContactShareItem(BaseModel):
    full_name: str = Field(min_length=1, max_length=256)
    phone_number: str = Field(min_length=8, max_length=32)


class SendContactsRequest(BaseModel):
    contacts: list[ContactShareItem] = Field(min_length=1, max_length=20)
    reply_to_message_id: int | None = Field(default=None, ge=1)


class SendInteractiveRequest(BaseModel):
    # Objeto ``interactive`` de Meta tal cual (con ``type``: button, list,
    # product, product_list, catalog_message, flow o call_permission_request).
    interactive: dict
    reply_to_message_id: int | None = Field(default=None, ge=1)


class ForwardMessagesRequest(BaseModel):
    # Mensajes del chat de origen a reenviar, y chats destino. Los topes son
    # los de WhatsApp: hasta 30 mensajes seleccionados y 5 chats por reenvío.
    message_ids: list[int] = Field(min_length=1, max_length=30)
    target_chat_ids: list[str] = Field(min_length=1, max_length=5)


class ForwardMessagesResponse(BaseModel):
    # Chats a los que efectivamente se encoló algo.
    forwarded_chats: int
    # Total de mensajes encolados (mensajes reenviables × chats destino).
    forwarded_messages: int
    # Mensajes que quedaron afuera por ser de un tipo que no se puede volver a
    # enviar (encuestas, contactos, stickers rotos…). El frontend lo avisa.
    skipped_messages: int


class ReactionRequest(BaseModel):
    # Emoji de la reacción. Vacío quita la reacción propia (como en WhatsApp).
    emoji: str = ""


class StickerRequest(BaseModel):
    # Id del asset de la librería de medios que se manda como sticker.
    asset_id: int = Field(ge=1)
