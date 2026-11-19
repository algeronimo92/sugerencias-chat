"""Contratos HTTP de la agenda de contactos."""

from uuid import UUID

from pydantic import BaseModel, Field

from app.modules.contacts.types import (
    ContactOrigin, DuplicatePolicy, ImportSource, RowOutcome, SelectionMode, SyncStatus, SyncType,
)


class ContactItem(BaseModel):
    id: str
    nombre: str | None
    telefono: str | None
    wa_user_id: str | None
    username: str | None
    email: str | None
    notas: str | None
    etiquetas: list[str]
    origen: ContactOrigin
    consentimiento_marketing: bool
    consentimiento_at: str | None
    lead_id: str | None
    eliminado_en_app_at: str | None
    ultima_interaccion_at: str | None
    created_at: str | None
    updated_at: str | None


class ContactPage(BaseModel):
    items: list[ContactItem]
    total: int


class ContactCreate(BaseModel):
    telefono: str = Field(max_length=40)
    nombre: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    notas: str | None = Field(default=None, max_length=2000)
    etiquetas: list[str] = Field(default_factory=list, max_length=20)
    consentimiento_marketing: bool = False


class ContactUpdate(BaseModel):
    telefono: str | None = Field(default=None, max_length=40)
    nombre: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    notas: str | None = Field(default=None, max_length=2000)
    etiquetas: list[str] | None = Field(default=None, max_length=20)
    consentimiento_marketing: bool | None = None


class ContactIds(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=1000)

    def id_strings(self) -> list[str]:
        return [str(contact_id) for contact_id in self.ids]


class ContactTagsChange(ContactIds):
    add: list[str] = Field(default_factory=list, max_length=20)
    remove: list[str] = Field(default_factory=list, max_length=20)


class AffectedCount(BaseModel):
    count: int


class PromotedLead(BaseModel):
    lead_id: str


class PromotedLeads(BaseModel):
    promoted: int
    # Contactos que no se pudieron pasar (sin número, por ejemplo).
    failed: int


# --- Importaciones -----------------------------------------------------------

class CsvColumnMapping(BaseModel):
    """Índice de la columna del CSV que llena cada campo; None si ninguna."""

    nombre: int | None = None
    telefono: int | None = None
    email: int | None = None
    etiquetas: int | None = None
    notas: int | None = None
    consentimiento: int | None = None


class CsvUpload(BaseModel):
    file_name: str | None = Field(default=None, max_length=200)
    # 5 MB de archivo son ~6,7 MB en base64.
    data_base64: str = Field(max_length=7_200_000)


class CsvImportCreate(CsvUpload):
    mapping: CsvColumnMapping


class CsvPreview(BaseModel):
    headers: list[str]
    sample: list[list[str]]
    total_rows: int
    mapping: CsvColumnMapping


class ImportCounts(BaseModel):
    # Válidas que esperan que alguien las elija.
    pending: int
    invalid: int
    # Pendientes que ya están en la agenda (mismo número o BSUID).
    existing: int
    # Pendientes con fecha de última conversación (vienen del historial).
    with_interaction: int
    created: int
    updated: int
    skipped: int
    discarded: int


class RecentWindowCount(BaseModel):
    days: int
    count: int


class ImportSummary(BaseModel):
    id: str
    source: ImportSource
    status: str
    file_name: str | None
    created_at: str | None
    updated_at: str | None
    closed_at: str | None
    counts: ImportCounts
    recent: list[RecentWindowCount]


class ImportRowItem(BaseModel):
    id: int
    row_number: int | None
    nombre: str | None
    telefono: str | None
    wa_user_id: str | None
    email: str | None
    etiquetas: list[str]
    consentimiento: bool
    ultima_interaccion_at: str | None
    error: str | None
    outcome: RowOutcome | None
    exists: bool


class ImportRowPage(BaseModel):
    items: list[ImportRowItem]
    total: int


class ImportSelection(BaseModel):
    """Qué parte de la importación pasa a la agenda."""

    mode: SelectionMode = SelectionMode.ALL
    # Para ``recent``: solo quienes conversaron en los últimos N días.
    days: int | None = Field(default=None, ge=1, le=365)
    # Tope de contactos; se toman primero los de conversación más reciente.
    limit: int | None = Field(default=None, ge=1, le=20_000)
    # Para ``manual``: las filas marcadas.
    row_ids: list[int] = Field(default_factory=list, max_length=20_000)
    duplicates: DuplicatePolicy = DuplicatePolicy.SKIP
    # Etiquetas que se suman a todos los importados (p. ej. "importado-nov").
    tags: list[str] = Field(default_factory=list, max_length=20)
    close: bool = False


class ImportResult(BaseModel):
    created: int
    updated: int
    skipped: int


# --- Sincronización con el celular ------------------------------------------

class WhatsAppSyncItem(BaseModel):
    phone_number_id: str
    sync_type: SyncType
    status: SyncStatus
    error: str | None
    progress: int | None
    requested_at: str | None
    updated_at: str | None
    window_ends_at: str | None
    can_retry: bool


class WhatsAppSyncStatus(BaseModel):
    auto_import: bool
    open_batch_id: str | None
    syncs: list[WhatsAppSyncItem]


class WhatsAppSyncSettings(BaseModel):
    auto_import: bool
