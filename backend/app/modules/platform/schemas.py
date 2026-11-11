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
    # Siembra el paquete "Clínica estética" (etiquetas, plantillas con atajo y
    # automatizaciones desactivadas). Es lo que se espera de un alta normal.
    starter_pack: bool = True

class PlatformSettingItem(BaseModel):
    key: str
    label: str
    # App a la que pertenece (meta, n8n, google, microsoft, zoho, email_oauth).
    group: str
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

class GoogleCalendarStatus(BaseModel):
    # La plataforma tiene su cliente OAuth: se puede ofrecer "Conectar".
    oauth_available: bool
    connected: bool
    account_email: str | None = None
    calendar_id: str | None = None
    enabled: bool
    business_timezone: str

class GoogleAuthorizeRequest(BaseModel):
    # window.location.origin del CRM: adonde vuelve el callback de Google.
    return_origin: str

class GoogleAuthorizeResponse(BaseModel):
    url: str

class GoogleCalendarItem(BaseModel):
    id: str
    summary: str
    primary: bool

class GoogleCalendarSelection(BaseModel):
    calendar_id: str

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


class WhatsappCostBreakdownItem(BaseModel):
    # Valores literales de Meta (MARKETING, UTILITY, SERVICE, AUTHENTICATION…
    # y REGULAR, FREE_CUSTOMER_SERVICE, FREE_ENTRY_POINT).
    pricing_category: str
    pricing_type: str
    volume: int
    cost: float


class WhatsappCostDay(BaseModel):
    day: str
    volume: int
    cost: float


class WhatsappCostsSummary(BaseModel):
    """Lo que Meta informó que cobró en el mes, en la moneda de la WABA. Meta
    advierte que la cifra es aproximada; la factura es la fuente final."""

    month: str
    currency: str | None = None
    total_cost: float
    billed_messages: int
    free_messages: int
    free_service_used: int
    free_service_limit: int
    breakdown: list[WhatsappCostBreakdownItem]
    days: list[WhatsappCostDay]
    last_synced_at: str | None = None


class StarterPackResult(BaseModel):
    """Cuántas filas agregó el paquete inicial; todo en cero = ya lo tenía."""

    tags: int
    categories: int
    templates: int
    automations: int
    # 1 si el negocio no tiene admin activo: plantillas y reglas quedaron
    # sin sembrar porque exigen autor.
    needs_admin: int


OnboardingStepKey = Literal["whatsapp", "team", "services", "google_calendar", "templates"]


class OnboardingStep(BaseModel):
    key: OnboardingStepKey
    done: bool
    optional: bool


class OnboardingStatus(BaseModel):
    steps: list[OnboardingStep]
    completed: int
    total: int
    all_done: bool
    dismissed: bool


class OrganizationOverview(BaseModel):
    """Resumen de un negocio en el panel de plataforma."""

    # Personas del equipo, contando las invitaciones que aún no se aceptaron.
    users: int
    # El mismo checklist de primeros pasos que ve el admin del negocio.
    setup: OnboardingStatus


EmailOAuthProvider = Literal["google", "microsoft", "zoho"]


class EmailSettingsStatus(BaseModel):
    # El negocio tiene correo propio (cuenta conectada o SMTP) y las
    # invitaciones salen de ahí.
    configured: bool
    mode: Literal["oauth", "smtp"] | None = None
    oauth_provider: EmailOAuthProvider | None = None
    oauth_account_email: str | None = None
    # Proveedores con "Conectar con…" habilitado por la plataforma.
    oauth_available: list[EmailOAuthProvider]
    # Sin correo propio, la plataforma igual puede enviar en su nombre.
    platform_available: bool
    host: str
    port: int
    security: Literal["starttls", "ssl"]
    username: str
    password_configured: bool
    from_address: str
    from_name: str


class EmailSettingsUpdate(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int
    security: Literal["starttls", "ssl"]
    username: str = Field(default="", max_length=254)
    # null conserva la contraseña guardada; nunca se devuelve.
    password: str | None = Field(default=None, max_length=512)
    from_address: str = Field(min_length=3, max_length=254)
    from_name: str = Field(default="", max_length=100)


class PlatformEmailStatus(BaseModel):
    # De dónde salen hoy los correos de respaldo: el panel, el .env o ninguno.
    source: Literal["platform", "environment"] | None
    host: str
    port: int
    security: Literal["starttls", "ssl"]
    username: str
    password_configured: bool
    from_address: str
    from_name: str
    environment_host: str | None = None
    environment_from_address: str | None = None


class PlatformEmailUpdate(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    security: Literal["starttls", "ssl"]
    username: str = Field(default="", max_length=254)
    # null conserva la contraseña guardada; nunca se devuelve.
    password: str | None = Field(default=None, max_length=512)
    from_address: str = Field(min_length=3, max_length=254)
    from_name: str = Field(default="", max_length=100)


class EmailConnectRequest(BaseModel):
    provider: EmailOAuthProvider
    # window.location.origin del CRM: adonde vuelve el callback.
    return_origin: str


class EmailTestResult(BaseModel):
    recipient: str
    source: Literal["tenant", "platform"]


class KnowledgeTemplateBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    document_type: Literal["ficha", "politica", "faq", "guion", "otro"] | None = None
    service_hint: str | None = Field(default=None, max_length=120)
    content: str = Field(min_length=1, max_length=100_000)
    is_active: bool = True


class KnowledgeTemplateUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    document_type: Literal["ficha", "politica", "faq", "guion", "otro"] | None = None
    service_hint: str | None = Field(default=None, max_length=120)
    content: str | None = Field(default=None, min_length=1, max_length=100_000)
    is_active: bool | None = None


class KnowledgeTemplateItem(BaseModel):
    id: int
    title: str
    document_type: str | None = None
    service_hint: str | None = None
    content: str
    is_active: bool
    version: int
    updated_at: str
