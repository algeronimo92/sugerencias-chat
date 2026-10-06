"""Domain HTTP contracts."""

from typing import Literal

from pydantic import BaseModel, Field
from app.modules.platform import branding as branding_service

class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1)

class DomainBody(BaseModel):
    hostname: str = Field(min_length=1, max_length=253)
    is_primary: bool = False

class NewOrganizationBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hostname: str = Field(min_length=1, max_length=253)
    admin_email: str | None = Field(default=None, max_length=254)
    admin_password: str | None = Field(default=None, min_length=8)
    settings: dict[str, str] = Field(default_factory=dict)

class PlatformSettingItem(BaseModel):
    key: str
    label: str
    secret: bool
    configured: bool
    # Lo calcula platform_settings: de dónde sale el valor efectivo.
    source: Literal["platform", "environment", "legacy", "missing"]
    value: str | None = None

class UpdatePlatformSettingsBody(BaseModel):
    values: dict[str, str]

class OrganizationAIBody(BaseModel):
    enabled: bool
    # NULL = sin tope. Se cuentan generaciones por mes calendario UTC.
    monthly_quota: int | None = Field(default=None, ge=0, le=1_000_000)

class OrganizationAIItem(BaseModel):
    enabled: bool
    monthly_quota: int | None = None
    used_this_month: int

class OrganizationIntegrationItem(BaseModel):
    key: str
    label: str
    configured: bool
    value: str | None = None

class BrandingBody(BaseModel):
    # Vacío vuelve a los valores de la plataforma (nombre de la organización
    # y color por defecto).
    display_name: str | None = Field(default=None, max_length=branding_service.MAX_NAME_LENGTH)
    primary_color: str | None = Field(default=None, max_length=7)

class BrandingLogoBody(BaseModel):
    data_base64: str = Field(min_length=1)

class BrandingItem(BaseModel):
    name: str
    display_name: str | None = None
    primary_color: str
    has_logo: bool
    version: int
    contrast_with_white: float



class SettingItem(BaseModel):
    key: str
    label: str
    group: str
    group_label: str
    secret: bool
    boolean: bool = False
    configured: bool
    value: str | None = None

class UpdateSettingsRequest(BaseModel):
    values: dict[str, str]

class MetaEmbeddedSignupRequest(BaseModel):
    code: str
    waba_id: str
    # Ausente en coexistencia con la app de WhatsApp Business: ese evento
    # (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) no lo manda, se resuelve del
    # lado del backend -- ver meta_service.complete_embedded_signup.
    phone_number_id: str | None = None

class MetaPublicConfig(BaseModel):
    app_id: str | None = None
    config_id: str | None = None

class BusinessTimezoneItem(BaseModel):
    id: str
    label: str
    offset_minutes: int

class OperatorItem(BaseModel):
    id: str
    email: str
    name: str


class OrganizationDomainItem(BaseModel):
    id: str
    hostname: str
    is_primary: bool


class OrganizationItem(BaseModel):
    id: str
    name: str
    status: str
    schema_name: str
    storage_prefix: str
    ai_enabled: bool
    ai_monthly_quota: int | None = None
    created_at: str | None = None
    # Revisión y estado de migración del schema del negocio.
    revision: str | None = None
    migration_status: str | None = None
    up_to_date: bool
    domains: list[OrganizationDomainItem]


class OrganizationList(BaseModel):
    # Revisión que espera este código: el panel compara cada negocio con ella.
    head: str | None = None
    items: list[OrganizationItem]


class WhatsappStatusItem(BaseModel):
    # Con Meta Cloud API no hay ciclo de QR: o el número está vinculado o
    # faltan las credenciales.
    state: Literal["open", "not_configured"]
    instance: str | None = None
