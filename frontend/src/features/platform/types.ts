import type { UserRole } from "../../shared/types";
import type { ApiSchemas, Delivered } from '../../shared/http/contract'

export interface SettingItem {
  key: string
  label: string
  group: string
  group_label: string
  secret: boolean
  boolean: boolean
  configured: boolean
  value: string | null
}

export type AppUser = Delivered<ApiSchemas['UserItem']>

/** La matriz de permisos del negocio: los tres roles y el catálogo. */
export type RolesMatrix = Delivered<ApiSchemas['RolesOut']>
export type RoleRow = Delivered<ApiSchemas['RoleItem']>
export type PermissionDef = Delivered<ApiSchemas['PermissionItem']>
/** Lo que PostgreSQL tiene aplicado hoy a los roles de base del negocio. */
export type DbPrivileges = Delivered<ApiSchemas['DbPrivilegesOut']>
export type DbRolePrivileges = Delivered<ApiSchemas['DbRolePrivileges']>

export type SellerOption = Delivered<ApiSchemas['SellerItem']>

export interface CreateUserPayload {
  email: string
  name: string
  role: UserRole
}

export interface UpdateUserPayload {
  id: number
  email?: string
  role?: UserRole
  is_active?: boolean
  /** WhatsApp para el aviso de venta; vacío lo borra. */
  phone?: string
  /** Le suenan las llamadas de WhatsApp y puede llamar a clientes. */
  can_handle_calls?: boolean
}

export type InvitationLink = Delivered<ApiSchemas['InvitationLinkOut']>

/** Con Meta Cloud API no hay ciclo de QR: el número está vinculado o faltan
 * las credenciales. */
export type WhatsappStatus = Delivered<ApiSchemas['WhatsappStatusItem']>
export type WhatsappState = WhatsappStatus['state']
/** Si el número puede activar las llamadas de WhatsApp, según Meta. */
export type CallingReadiness = Delivered<ApiSchemas['WhatsappCallingReadiness']>
/** Si las llamadas están activas en Meta y con qué horario. */
export type CallingSettings = Delivered<ApiSchemas['WhatsappCallingSettings']>
export type CallingUpdate = ApiSchemas['WhatsappCallingUpdate']
export type CallHoursSlot = ApiSchemas['CallHoursSlot']
export type WhatsappCostsSummary = Delivered<ApiSchemas['WhatsappCostsSummary']>
/** La API de Conversiones de Meta: citas de leads de anuncios informadas a Meta. */
export type MetaConversionsStatus = Delivered<ApiSchemas['MetaConversionsStatus']>
export type MetaConversionPage = Delivered<ApiSchemas['MetaConversionPage']>
export type MetaConversionItem = MetaConversionPage['items'][number]
export type MetaConversionCounts = MetaConversionsStatus['events'][number]
/** Lo que se manda al encender, apagar o cambiar el código de prueba: los
 *  campos con valor por defecto en el backend pueden omitirse. */
export type MetaConversionsUpdate = Pick<ApiSchemas['MetaConversionsUpdate'], 'enabled'> &
  Partial<Omit<ApiSchemas['MetaConversionsUpdate'], 'enabled'>>

export interface StatusOptions {
  enabled?: boolean
  // Reconsulta cada 3s hasta que la instancia queda vinculada (open). Se usa
  // mientras el panel de conexión está abierto para reflejar el escaneo del QR.
  pollUntilConnected?: boolean
}

/** El horario de un día. `weekday` va de 0 (lunes) a 6 (domingo). */
export type BusinessDayHours = ApiSchemas['BusinessDayHours']
export type BusinessHours = ApiSchemas['BusinessHoursOut']

export interface BusinessTimezoneItem {
  id: string
  label: string
  offset_minutes: number
}

export interface MetaPublicConfig {
  app_id: string | null
  config_id: string | null
}

/** Conexión del negocio con Google Calendar ("Conectar con Google"). */
export type GoogleCalendarStatus = Delivered<ApiSchemas['GoogleCalendarStatus']>
export type GoogleCalendarItem = Delivered<ApiSchemas['GoogleCalendarItem']>

/** Correo de envío propio del negocio (invitaciones y avisos). */
export type EmailSettingsStatus = Delivered<ApiSchemas['EmailSettingsStatus']>
export type EmailSettingsPayload = ApiSchemas['EmailSettingsUpdate']
export type EmailTestResult = Delivered<ApiSchemas['EmailTestResult']>
export type PlatformEmailStatus = Delivered<ApiSchemas['PlatformEmailStatus']>
export type PlatformEmailPayload = ApiSchemas['PlatformEmailUpdate']
export type EmailOAuthProvider = ApiSchemas['EmailConnectRequest']['provider']

// `phone_number_id` falta en coexistencia con la app de WhatsApp Business;
// `mode` dice si el número sigue en el celular o quedó solo en la API.
export type MetaEmbeddedSignupPayload = ApiSchemas['MetaEmbeddedSignupRequest']
export type MetaSignupMode = MetaEmbeddedSignupPayload['mode']

export type Domain = Delivered<ApiSchemas['OrganizationDomainItem']>;

export type Organization = Delivered<ApiSchemas['OrganizationItem']>;
export type OrganizationList = Delivered<ApiSchemas['OrganizationList']>;

/** Foto del negocio para el operador: equipo y primeros pasos. */
export type ResumenNegocio = Delivered<ApiSchemas['OrganizationOverview']>;
/** El login propio del negocio en la base, sin contraseña. */
export type AccesoBase = Delivered<ApiSchemas['DbAccessStatus']>;
/** Credenciales del login del negocio: la contraseña solo llega una vez. */
export type CredencialesBase = Delivered<ApiSchemas['DbAccessCredentials']>;

export type AsistenteNegocio = {
  enabled: boolean;
  monthly_quota: number | null;
  used_this_month: number;
};

export type IntegracionNegocio = {
  key: string;
  label: string;
  configured: boolean;
  value: string | null;
};

export type OperadorActual = Delivered<ApiSchemas['OperatorItem']>;

export type PlatformSetting = Delivered<ApiSchemas['PlatformSettingItem']>;

export type MarcaGuardada = {
  name: string;
  display_name: string | null;
  primary_color: string;
  has_logo: boolean;
  version: number;
  contrast_with_white: number;
};

export type OnboardingStatus = Delivered<ApiSchemas['OnboardingStatus']>;
export type OnboardingStep = Delivered<ApiSchemas['OnboardingStep']>;
export type OnboardingStepKey = OnboardingStep['key'];
export type StarterPackResult = Delivered<ApiSchemas['StarterPackResult']>;

/** Plantilla de conocimiento de la biblioteca de la plataforma. */
export type KnowledgeTemplate = Delivered<ApiSchemas['KnowledgeTemplateItem']>
export type KnowledgeTemplateInput = ApiSchemas['KnowledgeTemplateBody']
