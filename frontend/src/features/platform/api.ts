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

export async function fetchSellers() {
  return (await client.get<SellerOption[]>('/api/chats/sellers')).data
}

export async function sendPasswordReset(id: number) {
      await client.post(`/api/users/${id}/send-password-reset`)
    }

export async function resendInvitation(id: number) {
  return (
      await client.post<AppUser>(`/api/users/${id}/resend-invitation`)
    ).data
}

export async function fetchStatus(): Promise<WhatsappStatus> {
  const { data } = await client.get<WhatsappStatus>('/api/whatsapp/status')
  return data
}

export async function connectWhatsapp(): Promise<WhatsappQr> {
  return (await client.post<WhatsappQr>('/api/whatsapp/connect')).data
}

export async function logoutWhatsapp() {
  return (await client.post('/api/whatsapp/logout')).data
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

export async function fetchBusinessTimezones() {
  return (
      await client.get<BusinessTimezoneItem[]>('/api/settings/timezones')
    ).data
}

export async function loginOperator(email: string, password: string) {
  return (await client.post("/api/platform/auth/login", { email, password })).data
}

export async function createOrganization(name: string, hostname: string, adminEmail: string, adminPassword: string) {
  return (await client.post("/api/platform/organizations", {
        name,
        hostname,
        admin_email: adminEmail || null,
        admin_password: adminPassword || null,
      })).data
}

export async function addOrganizationDomain(organizacion: Organization, hostname: string) {
  return (await client.post(`/api/platform/organizations/${organizacion.id}/domains`, {
        hostname,
      })).data
}

export async function removeOrganizationDomain(organizacion: Organization, valor: string) {
  return (await client.delete(
        `/api/platform/organizations/${organizacion.id}/domains/${encodeURIComponent(valor)}`,
      )).data
}

export async function fetchOrganizationBranding(organizacion: Organization) {
  return (await client.get<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding`)).data
}

export async function saveOrganizationBranding(organizacion: Organization, nombre: string, color: string) {
  return (await client.put<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding`, {
          display_name: nombre,
          primary_color: color,
        })).data
}

export async function uploadOrganizationLogo(organizacion: Organization, archivo: File) {
  return (await client.put<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding/logo`, {
          data_base64: await leerComoBase64(archivo),
        })).data
}

export async function removeOrganizationLogo(organizacion: Organization) {
  return (await client.delete<MarcaGuardada>(`/api/platform/organizations/${organizacion.id}/branding/logo`)).data
}

export async function fetchOrganizationAi(organizacion: Organization) {
  return (await client.get<AsistenteNegocio>(`/api/platform/organizations/${organizacion.id}/ai`)).data
}

export async function fetchOrganizationIntegrations(organizacion: Organization) {
  return (await client.get<IntegracionNegocio[]>(`/api/platform/organizations/${organizacion.id}/integrations`)).data
}

export async function saveOrganizationAi(organizacion: Organization, habilitado: boolean, monthlyQuota: number | null) {
  return (await client.put<AsistenteNegocio>(`/api/platform/organizations/${organizacion.id}/ai`, {
          enabled: habilitado,
          monthly_quota: monthlyQuota,
        })).data
}

export async function saveOrganizationIntegrations(organizacion: Organization, integraciones: Record<string, string>) {
  return (await client.put<IntegracionNegocio[]>(`/api/platform/organizations/${organizacion.id}/integrations`, {
          values: integraciones,
        })).data
}

export async function setOrganizationStatus(organizacion: Organization, accion: "activate" | "suspend") {
  return (await client.post(`/api/platform/organizations/${organizacion.id}/${accion}`)).data
}

export async function fetchPlatformSettings() {
  return (await client.get<PlatformSetting[]>("/api/platform/settings")).data
}

export async function savePlatformSettings(values: Record<string, string>) {
  return (await client.put<PlatformSetting[]>("/api/platform/settings", { values })).data
}

export async function fetchOrganizations() {
  return (await client.get<{ head: string; items: Organization[] }>(
        "/api/platform/organizations",
      )).data
}

export async function logoutOperator() {
  return (await client.post("/api/platform/auth/logout")).data
}

export async function fetchOperator() {
  return (await client.get<OperadorActual>("/api/platform/auth/me")).data
}

function leerComoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",", 2)[1] ?? "");
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}
