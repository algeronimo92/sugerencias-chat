"""Domain HTTP contracts."""

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
    source: str
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
