import client from "../../shared/http/client";
import type { ApiResponse } from '../../shared/http/contract'
import type { AppUser, AsistenteNegocio, BusinessTimezoneItem, CreateUserPayload, GoogleCalendarItem, GoogleCalendarStatus, IntegracionNegocio, MarcaGuardada, MetaEmbeddedSignupPayload, MetaPublicConfig, OperadorActual, Organization, OrganizationList, PlatformSetting, SellerOption, SettingItem, UpdateUserPayload, WhatsappStatus } from './types';

export async function fetchUsers(): Promise<AppUser[]> {
  const { data } = await client.get<ApiResponse<'/api/users', 'get'>>('/api/users')
  return data
}

export async function createUser(payload: CreateUserPayload): Promise<AppUser> {
  const { data } = await client.post<ApiResponse<'/api/users', 'post'>>('/api/users', payload)
  return data
}

export async function updateUser({ id, ...values }: UpdateUserPayload): Promise<AppUser> {
  const { data } = await client.patch<ApiResponse<'/api/users/{user_id}', 'patch'>>(`/api/users/${id}`, values)
  return data
}

export async function fetchSellers(): Promise<SellerOption[]> {
  return (await client.get<ApiResponse<'/api/chats/sellers', 'get'>>('/api/chats/sellers')).data
}

export async function sendPasswordReset(id: number) {
  await client.post<ApiResponse<'/api/users/{user_id}/send-password-reset', 'post'>>(`/api/users/${id}/send-password-reset`)
}

export async function resendInvitation(id: number): Promise<AppUser> {
  return (
      await client.post<ApiResponse<'/api/users/{user_id}/resend-invitation', 'post'>>(`/api/users/${id}/resend-invitation`)
    ).data
}

export async function fetchStatus(): Promise<WhatsappStatus> {
  const { data } = await client.get<ApiResponse<'/api/whatsapp/status', 'get'>>('/api/whatsapp/status')
  return data
}

export async function fetchSettings(): Promise<SettingItem[]> {
  const { data } = await client.get<ApiResponse<'/api/settings', 'get'>>('/api/settings')
  return data
}

export async function saveSettings(values: Record<string, string>): Promise<SettingItem[]> {
  const { data } = await client.put<ApiResponse<'/api/settings', 'put'>>('/api/settings', { values })
  return data
}

export async function fetchMetaPublicConfig(): Promise<MetaPublicConfig> {
  const { data } = await client.get<ApiResponse<'/api/settings/meta/public-config', 'get'>>('/api/settings/meta/public-config')
  return data
}

export async function completeMetaEmbeddedSignup(payload: MetaEmbeddedSignupPayload): Promise<SettingItem[]> {
  const { data } = await client.post<ApiResponse<'/api/settings/meta/embedded-signup', 'post'>>('/api/settings/meta/embedded-signup', payload)
  return data
}

export async function fetchGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  return (
      await client.get<ApiResponse<'/api/settings/google-calendar/status', 'get'>>('/api/settings/google-calendar/status')
    ).data
}

/** URL de consentimiento de Google; el navegador se va ahí y vuelve al CRM. */
export async function authorizeGoogleCalendar(returnOrigin: string): Promise<string> {
  return (
      await client.post<ApiResponse<'/api/settings/google-calendar/authorize', 'post'>>('/api/settings/google-calendar/authorize', { return_origin: returnOrigin })
    ).data.url
}

export async function fetchGoogleCalendars(): Promise<GoogleCalendarItem[]> {
  return (
      await client.get<ApiResponse<'/api/settings/google-calendar/calendars', 'get'>>('/api/settings/google-calendar/calendars')
    ).data
}

export async function selectGoogleCalendar(calendarId: string): Promise<GoogleCalendarStatus> {
  return (
      await client.put<ApiResponse<'/api/settings/google-calendar/calendar', 'put'>>('/api/settings/google-calendar/calendar', { calendar_id: calendarId })
    ).data
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarStatus> {
  return (
      await client.post<ApiResponse<'/api/settings/google-calendar/disconnect', 'post'>>('/api/settings/google-calendar/disconnect')
    ).data
}

export async function fetchBusinessTimezones(): Promise<BusinessTimezoneItem[]> {
  return (
      await client.get<ApiResponse<'/api/settings/timezones', 'get'>>('/api/settings/timezones')
    ).data
}

export async function loginOperator(email: string, password: string) {
  return (await client.post<ApiResponse<'/api/platform/auth/login', 'post'>>("/api/platform/auth/login", { email, password })).data
}

export async function createOrganization(name: string, hostname: string, adminEmail: string, adminPassword: string) {
  return (await client.post<ApiResponse<'/api/platform/organizations', 'post'>>("/api/platform/organizations", {
        name,
        hostname,
        admin_email: adminEmail || null,
        admin_password: adminPassword || null,
      })).data
}

export async function addOrganizationDomain(organizacion: Organization, hostname: string) {
  return (await client.post<ApiResponse<'/api/platform/organizations/{organization_id}/domains', 'post'>>(`/api/platform/organizations/${organizacion.id}/domains`, {
        hostname,
      })).data
}

export async function removeOrganizationDomain(organizacion: Organization, valor: string) {
  return (await client.delete<ApiResponse<'/api/platform/organizations/{organization_id}/domains/{hostname}', 'delete'>>(
        `/api/platform/organizations/${organizacion.id}/domains/${encodeURIComponent(valor)}`,
      )).data
}

export async function fetchOrganizationBranding(organizacion: Organization): Promise<MarcaGuardada> {
  return (await client.get<ApiResponse<'/api/platform/organizations/{organization_id}/branding', 'get'>>(`/api/platform/organizations/${organizacion.id}/branding`)).data
}

export async function saveOrganizationBranding(organizacion: Organization, nombre: string, color: string): Promise<MarcaGuardada> {
  return (await client.put<ApiResponse<'/api/platform/organizations/{organization_id}/branding', 'put'>>(`/api/platform/organizations/${organizacion.id}/branding`, {
          display_name: nombre,
          primary_color: color,
        })).data
}

export async function uploadOrganizationLogo(organizacion: Organization, archivo: File): Promise<MarcaGuardada> {
  return (await client.put<ApiResponse<'/api/platform/organizations/{organization_id}/branding/logo', 'put'>>(`/api/platform/organizations/${organizacion.id}/branding/logo`, {
          data_base64: await leerComoBase64(archivo),
        })).data
}

export async function removeOrganizationLogo(organizacion: Organization): Promise<MarcaGuardada> {
  return (await client.delete<ApiResponse<'/api/platform/organizations/{organization_id}/branding/logo', 'delete'>>(`/api/platform/organizations/${organizacion.id}/branding/logo`)).data
}

export async function fetchOrganizationAi(organizacion: Organization): Promise<AsistenteNegocio> {
  return (await client.get<ApiResponse<'/api/platform/organizations/{organization_id}/ai', 'get'>>(`/api/platform/organizations/${organizacion.id}/ai`)).data
}

export async function fetchOrganizationIntegrations(organizacion: Organization): Promise<IntegracionNegocio[]> {
  return (await client.get<ApiResponse<'/api/platform/organizations/{organization_id}/integrations', 'get'>>(`/api/platform/organizations/${organizacion.id}/integrations`)).data
}

export async function saveOrganizationAi(organizacion: Organization, habilitado: boolean, monthlyQuota: number | null): Promise<AsistenteNegocio> {
  return (await client.put<ApiResponse<'/api/platform/organizations/{organization_id}/ai', 'put'>>(`/api/platform/organizations/${organizacion.id}/ai`, {
          enabled: habilitado,
          monthly_quota: monthlyQuota,
        })).data
}

export async function saveOrganizationIntegrations(organizacion: Organization, integraciones: Record<string, string>): Promise<IntegracionNegocio[]> {
  return (await client.put<ApiResponse<'/api/platform/organizations/{organization_id}/integrations', 'put'>>(`/api/platform/organizations/${organizacion.id}/integrations`, {
          values: integraciones,
        })).data
}

export async function setOrganizationStatus(organizacion: Organization, accion: "activate" | "suspend") {
  if (accion === "activate") {
    await client.post<ApiResponse<'/api/platform/organizations/{organization_id}/activate', 'post'>>(`/api/platform/organizations/${organizacion.id}/activate`)
    return
  }
  await client.post<ApiResponse<'/api/platform/organizations/{organization_id}/suspend', 'post'>>(`/api/platform/organizations/${organizacion.id}/suspend`)
}

export async function fetchPlatformSettings(): Promise<PlatformSetting[]> {
  return (await client.get<ApiResponse<'/api/platform/settings', 'get'>>("/api/platform/settings")).data
}

export async function savePlatformSettings(values: Record<string, string>): Promise<PlatformSetting[]> {
  return (await client.put<ApiResponse<'/api/platform/settings', 'put'>>("/api/platform/settings", { values })).data
}

export async function fetchOrganizations(): Promise<OrganizationList> {
  return (await client.get<ApiResponse<'/api/platform/organizations', 'get'>>(
        "/api/platform/organizations",
      )).data
}

export async function logoutOperator() {
  return (await client.post<ApiResponse<'/api/platform/auth/logout', 'post'>>("/api/platform/auth/logout")).data
}

export async function fetchOperator(): Promise<OperadorActual> {
  return (await client.get<ApiResponse<'/api/platform/auth/me', 'get'>>("/api/platform/auth/me")).data
}

function leerComoBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",", 2)[1] ?? "");
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}
