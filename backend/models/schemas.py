from pydantic import BaseModel


class Chat(BaseModel):
    chat_id: str
    phone: str | None = None
    name: str | None = None
    servicio_interes: str | None = None
    vendedor: str | None = None
    origen: str | None = None
    notas: str | None = None
    last_message: str | None = None
    timestamp: str | None = None


class ChatPage(BaseModel):
    items: list[Chat]
    has_more: bool


class Message(BaseModel):
    id: int
    sender: str
    content: str | None = None
    sent_at: str | None = None
    media_url: str | None = None


class SendMessageRequest(BaseModel):
    text: str


class SendMediaRequest(BaseModel):
    content_type: str
    data_base64: str
    filename: str | None = None


class SendLocationRequest(BaseModel):
    latitude: float
    longitude: float


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
    estado: str
    tipo_objecion: str | None = None
    confianza: str
    analisis: str
    sugerencias: list[Sugerencia]
