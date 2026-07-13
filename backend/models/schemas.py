from typing import Literal

from pydantic import BaseModel


LeadStage = Literal[
    "nuevo",
    "calificacion",
    "cotizacion",
    "objecion",
    "cierre",
    "agendado",
    "postventa",
    "sin_respuesta",
    "reactivacion",
    "perdido",
]


class Chat(BaseModel):
    chat_id: str
    phone: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor: str | None = None
    origen: str | None = None
    notas: str | None = None
    stage: LeadStage = "nuevo"
    last_message: str | None = None
    last_message_sender: str | None = None
    timestamp: str | None = None
    unread_count: int = 0


class ChatPage(BaseModel):
    items: list[Chat]
    has_more: bool


class KanbanPage(BaseModel):
    items: list[Chat]
    has_more: bool


class LeadStageUpdate(BaseModel):
    stage: LeadStage


class Message(BaseModel):
    id: int
    sender: str
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None
    wa_message_id: str | None = None
    status: str | None = None


class MessagePage(BaseModel):
    items: list[Message]
    has_more: bool


class MessageStatusUpdate(BaseModel):
    wa_message_id: str
    status: str


class SendMessageRequest(BaseModel):
    text: str


class SendMediaRequest(BaseModel):
    content_type: str
    data_base64: str
    filename: str | None = None


class SendLocationRequest(BaseModel):
    latitude: float
    longitude: float


class TtsRequest(BaseModel):
    text: str


class TtsResponse(BaseModel):
    content_type: str
    data_base64: str


class LeadCreate(BaseModel):
    phone: str
    name: str
    servicio_interes: str | None = None
    vendedor: str | None = None
    origen: str | None = None
    notas: str | None = None


class LeadUpdate(BaseModel):
    phone: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor: str | None = None
    origen: str | None = None
    notas: str | None = None


class SuggestionRequest(BaseModel):
    chat_id: str
    phone: str | None = None


class Sugerencia(BaseModel):
    tactica: str
    canal: str
    texto: str | None = None
    adjuntos: list[str] = []
    motivo_adjuntos: str = ""
    porque: str


class SuggestionResponse(BaseModel):
    # Debe coincidir con el enum `lead_estado` y con el Structured Output
    # Parser del agente n8n. Pydantic rechaza cualquier etapa inventada antes
    # de que llegue a PostgreSQL.
    estado: LeadStage
    tipo_objecion: str | None = None
    confianza: str
    analisis: str
    sugerencias: list[Sugerencia]
