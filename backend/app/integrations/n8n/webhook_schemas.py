"""Cuerpos de los webhooks que entran desde el workflow analista de n8n.

Son un contrato con sistemas de afuera, distinto de los DTO de la API propia
que viven en app/modules/<capacidad>/schemas.py. El webhook de Meta no tiene
DTO: su cuerpo se guarda tal como llega (ver app/integrations/meta_webhook).
"""

from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


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
