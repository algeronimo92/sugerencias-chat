import client from "../../shared/http/client";
import type { AppUser,AsistenteNegocio,BusinessTimezoneItem,CreateUserPayload,IntegracionNegocio,MarcaGuardada,MetaEmbeddedSignupPayload,MetaPublicConfig,OperadorActual,Organization,PlatformSetting,SellerOption,SettingItem,UpdateUserPayload,WhatsappQr,WhatsappStatus } from './types';

export async function fetchUsers(): Promise<AppUser[]> {
  const { data } = await client.get<AppUser[]>('/api/users')
  return data
}

export async function createUser(payload: CreateUserPayload): Promise<AppUser> {
  const { data } = await client.post<AppUser>('/api/users', payload)
  return data
}

export async function updateUser({ id, ...values }: UpdateUserPayload): Promise<AppUser> {
  const { data } = await client.patch<AppUser>(`/api/users/${id}`, values)
  return data
}

export function requestSellers() {
  return async () => (await client.get<SellerOption[]>('/api/chats/sellers')).data
}

export function requestSendPasswordReset() {
  return async (id: number) => {
      await client.post(`/api/users/${id}/send-password-reset`)
    }
}

export function requestResendInvitation() {
  return async (id: number) => (
      await client.post<AppUser>(`/api/users/${id}/resend-invitation`)
    ).data
}

export async function fetchStatus(): Promise<WhatsappStatus> {
  const { data } = await client.get<WhatsappStatus>('/api/whatsapp/status')
  return data
}

export function requestConnectWhatsapp() {
  return async (): Promise<WhatsappQr> =>
      (await client.post<WhatsappQr>('/api/whatsapp/connect')).data
}

export function requestLogoutWhatsapp() {
  return async () => (await client.post('/api/whatsapp/logout')).data
}

export async function fetchSettings(): Promise<SettingItem[]> {
  const { data } = await client.get<SettingItem[]>('/api/settings')
  return data
}

export async function saveSettings(values: Record<string, string>): Promise<SettingItem[]> {
  const { data } = await client.put<SettingItem[]>('/api/settings', { values })
  return data
}

export async function fetchMetaPublicConfig(): Promise<MetaPublicConfig> {
  const { data } = await client.get<MetaPublicConfig>('/api/settings/meta/public-config')
  return data
}

export async function completeMetaEmbeddedSignup(payload: MetaEmbeddedSignupPayload): Promise<SettingItem[]> {
  const { data } = await client.post<SettingItem[]>('/api/settings/meta/embedded-signup', payload)
  return data
}

export function requestBusinessTimezones() {
  return async () => (
      await client.get<BusinessTimezoneItem[]>('/api/settings/timezones')
    ).data
}

export function postApiPlatformAuthLogin0(email: string, password: string) {
  return client.post("/api/platform/auth/login", { email, password })
}

export function postApiPlatformOrganizations1(name: string, hostname: string, adminEmail: string, adminPassword: string) {
  return client.post("/api/platform/organizations", {
        name,
        hostname,
        admin_email: adminEmail || null,
        admin_password: adminPassword || null,
      })
}

export function postApiPlatformOrganizationsDomains2(organizacion: Organization, hostname: string) {
  return client.post(`/api/platform/organizations/${organizacion.id}/domains`, {
        hostname,
      })
}

export function deleteApiPlatformOrganizationsDomains3(organizacion: Organization, valor: string) {
  return client.delete(
        `/api/platform/organizations/${organizacion.id}/domains/${encodeURIComponent(valor)}`,
      )
}

export function getApiPlatformOrganizationsBranding4(organizacion: Organization) {
  return client.get<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding`)
}

export function putApiPlatformOrganizationsBranding5(organizacion: Organization, nombre: string, color: string) {
  return client.put<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding`, {
          display_name: nombre,
          primary_color: color,
        })
}

export async function putApiPlatformOrganizationsBrandingLogo6(organizacion: Organization, archivo: File) {
  return client.put<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding/logo`, {
          data_base64: await leerComoBase64(archivo),
        })
}

export function deleteApiPlatformOrganizationsBrandingLogo7(organizacion: Organization) {
  return client.delete<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding/logo`)
}

export function getApiPlatformOrganizationsAi8(organizacion: Organization) {
  return client.get<AsistenteNegocio>(`/api/platform/organizations/${organizacion.id}/ai`)
}

export function getApiPlatformOrganizationsIntegrations9(organizacion: Organization) {
  return client.get<IntegracionNegocio[]>(`/api/platform/organizations/${organizacion.id}/integrations`)
}

export function putApiPlatformOrganizationsAi10(organizacion: Organization, habilitado: boolean, monthlyQuota: number | null) {
  return client.put<AsistenteNegocio>(`/api/platform/organizations/${organizacion.id}/ai`, {
          enabled: habilitado,
          monthly_quota: monthlyQuota,
        })
}

export function putApiPlatformOrganizationsIntegrations11(organizacion: Organization, integraciones: Record<string, string>) {
  return client.put<IntegracionNegocio[]>(`/api/platform/organizations/${organizacion.id}/integrations`, {
          values: integraciones,
        })
}

export function postApiPlatformOrganizations12(organizacion: Organization, accion: "activate" | "suspend") {
  return client.post(`/api/platform/organizations/${organizacion.id}/${accion}`)
}

export function getApiPlatformSettings13() {
  return client.get<PlatformSetting[]>("/api/platform/settings")
}

export function putApiPlatformSettings14(values: Record<string, string>) {
  return client.put<PlatformSetting[]>("/api/platform/settings", { values })
}

export function getApiPlatformOrganizations15() {
  return client.get<{ head: string; items: Organization[] }>(
        "/api/platform/organizations",
      )
}

export function postApiPlatformAuthLogout16() {
  return client.post("/api/platform/auth/logout")
}

export function getApiPlatformAuthMe17() {
  return client.get<OperadorActual>("/api/platform/auth/me")
}

function leerComoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",", 2)[1] ?? "");
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}
