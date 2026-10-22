"""Cuerpos de los webhooks que entran desde los workflows de IA de n8n.

Son un contrato con sistemas de afuera, distinto de los DTO de la API propia
que viven en app/modules/<capacidad>/schemas.py. El webhook de Meta no tiene
DTO: su cuerpo se guarda tal como llega (ver app/integrations/meta_webhook).
"""

from datetime import date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class LeadTouchWebhookBody(BaseModel):
    # wa_id o user_id del contacto, tal como los informa Meta.
    identifier: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class LeadStageWebhookBody(BaseModel):
    chat_id: str
    # None = el agente no decidió etapa en esta corrida; el webhook no hace
    # nada, así n8n puede llamarlo siempre sin un nodo IF adelante.
    estado: str | None = None
    razonamiento: str | None = None


class LeadAnalysisWebhookBody(BaseModel):
    """Campos del lead que escribe el agente analista de n8n. Todo opcional:
    solo se actualiza lo que el agente resolvió en esa corrida."""

    chat_id: str
    # Opaque revision obtained with the context. The backend rejects results
    # computed from lead or message data that has changed since then.
    context_revision: str | None = None
    job_id: str | None = None
    nombre: str | None = None
    telefono: str | None = None
    servicio_interes: str | None = None
    notas: str | None = None
    razon_perdido: str | None = None
    fecha_recontacto: date | None = None
    tipo_objecion: str | None = None
    proxima_cita: datetime | None = None
    con_especialista: bool | None = None

    # Reject attempts to copy the old UPDATE, including protected conversation
    # and automation state, instead of silently ignoring those fields.
    model_config = ConfigDict(extra="forbid")


class LeadAnalysisPatch(BaseModel):
    """Patch produced by the analyst.

    ``model_fields_set`` distinguishes absent (preserve) from explicit null
    (clear a nullable column). Conversation and automation controls are not
    part of this contract.
    """

    nombre: str | None = None
    telefono: str | None = None
    servicio_interes: str | None = None
    notas: str | None = None
    razon_perdido: str | None = Field(default=None, max_length=500)
    fecha_recontacto: date | None = None
    tipo_objecion: str | None = None
    proxima_cita: datetime | None = None
    con_especialista: bool | None = None

    model_config = ConfigDict(extra="forbid")


class LeadAnalysisResultWebhookBody(BaseModel):
    """Resultado completo de un job ``analyst`` ejecutado a demanda."""

    chat_id: str
    context_revision: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    fields: LeadAnalysisPatch = Field(default_factory=LeadAnalysisPatch)
    estado: str | None = None
    razonamiento: str | None = None

    model_config = ConfigDict(extra="forbid")


class RagSearchWebhookBody(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    context_revision: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    top_k: int = Field(default=5, ge=1, le=20)

    model_config = ConfigDict(extra="forbid")


class LeadInboundActivityWebhookBody(BaseModel):
    """Último mensaje del chat, tal como lo veía el nodo `update lead4`."""

    chat_id: str
    ultimo_emisor: str | None = None
    ultimo_mensaje_at: str | None = None

    model_config = ConfigDict(extra="forbid")
