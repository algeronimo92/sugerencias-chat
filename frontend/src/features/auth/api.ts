import client from "../../shared/http/client";
import type { ActionTokenInfo, AuthSession, AuthUser, LoginPayload, MfaStatus, PinStatus } from "./types";

export async function login(payload: LoginPayload): Promise<AuthUser> {
  const { data } = await client.post<AuthUser>('/api/auth/login', {
    ...payload,
    mfa_code: payload.mfa_code?.trim() || null,
  })
  return data
}

export async function logout(): Promise<void> {
  await client.post('/api/auth/logout')
}

export async function pinLogin(pin: string) {
  return (
      await client.post<AuthUser>('/api/auth/pin/login', { pin })
    ).data
}

export async function fetchPinStatus() {
  return (await client.get<PinStatus>('/api/auth/pin/status')).data
}

export async function setupPin({ pin, currentPassword }: { pin: string; currentPassword: string }) {
  return (
      await client.post<PinStatus>('/api/auth/pin/setup', { pin, current_password: currentPassword })
    ).data
}

export async function removePin() { await client.delete('/api/auth/pin') }

export async function fetchSessions() {
  return (await client.get<AuthSession[]>('/api/auth/sessions')).data
}

export async function revokeSession(sessionId: string) { await client.delete(`/api/auth/sessions/${sessionId}`) }

export async function logoutAll() { await client.post('/api/auth/logout-all') }

export async function fetchMfaStatus() {
  return (await client.get<MfaStatus>('/api/auth/mfa/status')).data
}

export async function startMfa(currentPassword: string) {
  return (
      await client.post<{ secret: string; otpauth_uri: string }>('/api/auth/mfa/start', { current_password: currentPassword })
    ).data
}

export async function confirmMfa(code: string) {
  return (
      await client.post<{ recovery_codes: string[] }>('/api/auth/mfa/confirm', { code })
    ).data
}

export async function disableMfa({ code, currentPassword }: { code: string; currentPassword: string }) {
      await client.post('/api/auth/mfa/disable', { code, current_password: currentPassword })
    }

export async function requestPasswordReset(email: string) {
      await client.post('/api/auth/forgot-password', { email })
    }

export async function fetchActionToken(token: string) {
  return (
      await client.get<ActionTokenInfo>(`/api/auth/action-token/${encodeURIComponent(token)}`)
    ).data
}

export async function completeAccountAction(purpose: "invitation" | "password_reset" | undefined, { token, password }: { token: string; password: string }) {
      const path = purpose === 'invitation' ? 'accept-invitation' : 'reset-password'
      await client.post(`/api/auth/${path}`, { token, password })
    }
