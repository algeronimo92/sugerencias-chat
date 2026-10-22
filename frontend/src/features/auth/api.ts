import client from "../../shared/http/client";
import type { ApiResponse } from '../../shared/http/contract'
import type { ActionTokenInfo, AuthSession, AuthUser, LoginPayload, MfaStatus, PinStatus } from "./types";

export async function login(payload: LoginPayload): Promise<AuthUser> {
  const { data } = await client.post<ApiResponse<'/api/auth/login', 'post'>>('/api/auth/login', {
    ...payload,
    mfa_code: payload.mfa_code?.trim() || null,
  })
  return data
}

export async function logout(): Promise<void> {
  await client.post<ApiResponse<'/api/auth/logout', 'post'>>('/api/auth/logout')
}

export async function pinLogin(pin: string): Promise<AuthUser> {
  return (
      await client.post<ApiResponse<'/api/auth/pin/login', 'post'>>('/api/auth/pin/login', { pin })
    ).data
}

export async function fetchPinStatus(): Promise<PinStatus> {
  return (await client.get<ApiResponse<'/api/auth/pin/status', 'get'>>('/api/auth/pin/status')).data
}

export async function setupPin({ pin, currentPassword }: { pin: string; currentPassword: string }): Promise<PinStatus> {
  return (
      await client.post<ApiResponse<'/api/auth/pin/setup', 'post'>>('/api/auth/pin/setup', { pin, current_password: currentPassword })
    ).data
}

export async function removePin() { await client.delete<ApiResponse<'/api/auth/pin', 'delete'>>('/api/auth/pin') }

export async function fetchSessions(): Promise<AuthSession[]> {
  return (await client.get<ApiResponse<'/api/auth/sessions', 'get'>>('/api/auth/sessions')).data
}

export async function revokeSession(sessionId: string) { await client.delete<ApiResponse<'/api/auth/sessions/{session_id}', 'delete'>>(`/api/auth/sessions/${sessionId}`) }

export async function logoutAll() { await client.post<ApiResponse<'/api/auth/logout-all', 'post'>>('/api/auth/logout-all') }

export async function fetchMfaStatus(): Promise<MfaStatus> {
  return (await client.get<ApiResponse<'/api/auth/mfa/status', 'get'>>('/api/auth/mfa/status')).data
}

export async function startMfa(currentPassword: string): Promise<{ secret: string; otpauth_uri: string }> {
  return (
      await client.post<ApiResponse<'/api/auth/mfa/start', 'post'>>('/api/auth/mfa/start', { current_password: currentPassword })
    ).data
}

export async function confirmMfa(code: string): Promise<{ recovery_codes: string[] }> {
  return (
      await client.post<ApiResponse<'/api/auth/mfa/confirm', 'post'>>('/api/auth/mfa/confirm', { code })
    ).data
}

export async function disableMfa({ code, currentPassword }: { code: string; currentPassword: string }) {
  await client.post<ApiResponse<'/api/auth/mfa/disable', 'post'>>('/api/auth/mfa/disable', { code, current_password: currentPassword })
}

export async function requestPasswordReset(email: string) {
  await client.post<ApiResponse<'/api/auth/forgot-password', 'post'>>('/api/auth/forgot-password', { email })
}

export async function fetchActionToken(token: string): Promise<ActionTokenInfo> {
  return (
      await client.get<ApiResponse<'/api/auth/action-token/{token}', 'get'>>(`/api/auth/action-token/${encodeURIComponent(token)}`)
    ).data
}

export async function completeAccountAction(purpose: string | undefined, { token, password }: { token: string; password: string }) {
  if (purpose === 'invitation') {
    await client.post<ApiResponse<'/api/auth/accept-invitation', 'post'>>('/api/auth/accept-invitation', { token, password })
    return
  }
  await client.post<ApiResponse<'/api/auth/reset-password', 'post'>>('/api/auth/reset-password', { token, password })
}
