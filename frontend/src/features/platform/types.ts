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

export type SellerOption = Delivered<ApiSchemas['SellerItem']>

export interface CreateUserPayload {
  email: string
  name: string
  role: UserRole
}

export interface UpdateUserPayload {
  id: number
  role?: UserRole
  is_active?: boolean
}

/** Con Meta Cloud API no hay ciclo de QR: el número está vinculado o faltan
 * las credenciales. */
export type WhatsappStatus = Delivered<ApiSchemas['WhatsappStatusItem']>
export type WhatsappState = WhatsappStatus['state']

export interface StatusOptions {
  enabled?: boolean
  // Reconsulta cada 3s hasta que la instancia queda vinculada (open). Se usa
  // mientras el panel de conexión está abierto para reflejar el escaneo del QR.
  pollUntilConnected?: boolean
}

export interface BusinessTimezoneItem {
  id: string
  label: string
  offset_minutes: number
}

export interface MetaPublicConfig {
  app_id: string | null
  config_id: string | null
}

export interface MetaEmbeddedSignupPayload {
  code: string
  waba_id: string
  // Ausente en coexistencia con la app de WhatsApp Business (ver WhatsappPanel.tsx).
  phone_number_id?: string
}

export type Domain = Delivered<ApiSchemas['OrganizationDomainItem']>;

export type Organization = Delivered<ApiSchemas['OrganizationItem']>;
export type OrganizationList = Delivered<ApiSchemas['OrganizationList']>;

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
