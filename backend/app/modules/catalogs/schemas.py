"""Contratos HTTP de catalogs."""

from decimal import Decimal
from typing import Any, Literal
from pydantic import BaseModel, Field
from app.modules.tasks.ports.types import TaskType
from app.modules.catalogs.tag_schema import Tag
from app.modules.leads.schemas import LeadStageKey


class TagCreate(BaseModel):
    name: str
    color: str = "#16a34a"


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    is_active: bool | None = None


class LeadServiceItem(BaseModel):
    id: int
    name: str
    is_active: bool = True
    description: str | None = None
    price: Decimal | None = None
    price_notes: str | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None


class LeadServiceCreate(BaseModel):
    name: str = Field(max_length=120)


class LeadServiceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    # Catálogo que consulta el asistente IA. La moneda es la del perfil del
    # negocio; ``price_notes`` cubre packs, promociones o rangos.
    description: str | None = Field(default=None, max_length=1000)
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    price_notes: str | None = Field(default=None, max_length=500)


class TemplateCategoryItem(BaseModel):
    id: int
    name: str
    is_active: bool = True
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None


class TemplateCategoryCreate(BaseModel):
    name: str = Field(max_length=60)


class TemplateCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    is_active: bool | None = None


CustomFieldEntity = Literal["lead", "appointment"]
CustomFieldType = Literal["text", "textarea", "number", "date", "datetime", "boolean", "select"]


class CustomFieldDefinitionCreate(BaseModel):
    entity_type: CustomFieldEntity
    label: str = Field(min_length=1, max_length=80)
    key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{0,39}$")
    field_type: CustomFieldType = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=50)
    position: int = Field(default=0, ge=0, le=10000)


class CustomFieldDefinitionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    required: bool | None = None
    options: list[str] | None = Field(default=None, max_length=50)
    position: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class CustomFieldDefinitionItem(BaseModel):
    id: int
    entity_type: CustomFieldEntity
    key: str
    label: str
    field_type: CustomFieldType
    required: bool
    options: list[str]
    position: int
    is_active: bool


class CustomFieldValues(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class TemplateCreate(BaseModel):
    name: str
    content: str
    shortcut: str | None = None
    category: str = "General"
    stage: LeadStageKey | None = None
    task_type: TaskType | None = None
    service: str | None = None
    template_type: Literal["internal", "official"] = "internal"
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: str | None = None
    official_parameter_values: list[str] = Field(default_factory=list)
    official_header_type: Literal["none", "text", "image"] = "none"
    official_header_text: str | None = None
    official_header_media_asset_id: int | None = None
    official_footer: str | None = None
    official_buttons: list[dict] = Field(default_factory=list)
    interactive_type: Literal["none", "button", "list"] = "none"
    interactive_config: dict = Field(default_factory=dict)


class PersonalTemplateCreate(BaseModel):
    name: str
    content: str
    shortcut: str | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    content: str | None = None
    shortcut: str | None = None
    category: str | None = None
    stage: LeadStageKey | None = None
    task_type: TaskType | None = None
    service: str | None = None
    is_active: bool | None = None
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: str | None = None
    official_parameter_values: list[str] | None = None
    official_header_type: Literal["none", "text", "image"] | None = None
    official_header_text: str | None = None
    official_header_media_asset_id: int | None = None
    official_footer: str | None = None
    official_buttons: list[dict] | None = None
    interactive_type: Literal["none", "button", "list"] | None = None
    interactive_config: dict | None = None


class TemplateItem(BaseModel):
    id: int
    name: str
    content: str
    shortcut: str | None = None
    category: str
    stage: LeadStageKey | None = None
    task_type: TaskType | None = None
    service: str | None = None
    is_active: bool
    visibility: Literal["global", "personal"] = "global"
    template_type: Literal["internal", "official"] = "internal"
    official_name: str | None = None
    official_language: str | None = None
    official_category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"] | None = None
    official_status: str | None = None
    official_rejected_reason: str | None = None
    official_parameter_values: list[str] = Field(default_factory=list)
    meta_template_id: str | None = None
    official_header_type: Literal["none", "text", "image"] = "none"
    official_header_text: str | None = None
    official_header_media_asset_id: int | None = None
    official_header_media_url: str | None = None
    official_header_media_content_type: str | None = None
    official_header_media_filename: str | None = None
    official_footer: str | None = None
    official_buttons: list[dict] = Field(default_factory=list)
    interactive_type: Literal["none", "button", "list"] = "none"
    interactive_config: dict = Field(default_factory=dict)
    imported_from_meta: bool = False
    is_favorite: bool = False
    last_used_at: str | None = None
    use_count: int = 0
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None
    attachments: list["TemplateAttachmentItem"] = Field(default_factory=list)


class TemplateMetaImport(BaseModel):
    name: str
    category: str
    shortcut: str | None = None
    official_parameter_values: list[str] = Field(default_factory=list)


class TemplateAttachmentItem(BaseModel):
    id: int
    media_url: str
    content_type: str
    filename: str
    position: int
    library_asset_id: int | None = None


class TemplateAttachmentCreate(BaseModel):
    content_type: str
    data_base64: str
    filename: str


class TemplateLibraryAttachmentCreate(BaseModel):
    asset_id: int


class SendTemplateRequest(BaseModel):
    text: str | None = None
    parameters: list[str] = Field(default_factory=list)


class InteractiveLimits(BaseModel):
    text: int
    body: int
    title: int
    footer: int
    button_text: int
    button_id: int
    max_buttons: int
    list_button_text: int
    section_title: int
    row_title: int
    row_description: int
    row_id: int
    max_sections: int
    max_rows: int


class TemplateCapabilities(BaseModel):
    integration: str | None = None
    official_sending_supported: bool = False
    reason: str | None = None
    interactive_limits: InteractiveLimits
    interactive_default_footer: str = ""
    # Salidas que dependen de la cuenta (contracts/meta_messages.json).
    catalog_enabled: bool = False
    flows_enabled: bool = False
    call_permission_enabled: bool = False
    # Con qué completar esas salidas: el catálogo de la cuenta y los Flows
    # publicados (id o nombre, tal como se configuraron).
    catalog_id: str | None = None
    published_flows: list[str] = Field(default_factory=list)


class TemplateFavoriteUpdate(BaseModel):
    is_favorite: bool
