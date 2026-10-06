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

export type WhatsappState =
  | 'open'
  | 'connecting'
  | 'close'
  | 'missing'
  | 'not_configured'
  | 'unknown'

export interface WhatsappStatus {
  state: WhatsappState
  instance: string | null
}

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

export type Domain = { id: string; hostname: string; is_primary: boolean };

export type Organization = {
  id: string;
  name: string;
  status: string;
  schema_name: string;
  storage_prefix: string | null;
  created_at: string | null;
  revision: string | null;
  migration_status: string | null;
  up_to_date: boolean;
  ai_enabled: boolean;
  ai_monthly_quota: number | null;
  domains: Domain[];
};

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

export type OperadorActual = { id: string; email: string; name: string };

export type PlatformSetting = Delivered<ApiSchemas['PlatformSettingItem']>;

export type MarcaGuardada = {
  name: string;
  display_name: string | null;
  primary_color: string;
  has_logo: boolean;
  version: number;
  contrast_with_white: number;
};
