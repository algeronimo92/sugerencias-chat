import client from "../../shared/http/client";
import type { ActionTokenInfo,AuthSession,AuthUser,LoginPayload,MfaStatus,PinStatus } from "./types";

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

export function requestPinLogin() {
  return async (pin: string) => (
      await client.post<AuthUser>('/api/auth/pin/login', { pin })
    ).data
}

export function requestPinStatus() {
  return async () => (await client.get<PinStatus>('/api/auth/pin/status')).data
}

export function requestSetupPin() {
  return async ({ pin, currentPassword }: { pin: string; currentPassword: string }) => (
      await client.post<PinStatus>('/api/auth/pin/setup', { pin, current_password: currentPassword })
    ).data
}

export function requestRemovePin() {
  return async () => { await client.delete('/api/auth/pin') }
}

export function requestSessions() {
  return async () => (await client.get<AuthSession[]>('/api/auth/sessions')).data
}

export function requestRevokeSession() {
  return async (sessionId: string) => { await client.delete(`/api/auth/sessions/${sessionId}`) }
}

export function requestLogoutAll() {
  return async () => { await client.post('/api/auth/logout-all') }
}

export function requestMfaStatus() {
  return async () => (await client.get<MfaStatus>('/api/auth/mfa/status')).data
}

export function requestStartMfa() {
  return async (currentPassword: string) => (
      await client.post<{ secret: string; otpauth_uri: string }>('/api/auth/mfa/start', { current_password: currentPassword })
    ).data
}

export function requestConfirmMfa() {
  return async (code: string) => (
      await client.post<{ recovery_codes: string[] }>('/api/auth/mfa/confirm', { code })
    ).data
}

export function requestDisableMfa() {
  return async ({ code, currentPassword }: { code: string; currentPassword: string }) => {
      await client.post('/api/auth/mfa/disable', { code, current_password: currentPassword })
    }
}

export function requestRequestPasswordReset() {
  return async (email: string) => {
      await client.post('/api/auth/forgot-password', { email })
    }
}

export function requestActionToken(token: string) {
  return async () => (
      await client.get<ActionTokenInfo>(`/api/auth/action-token/${encodeURIComponent(token)}`)
    ).data
}

export function requestCompleteAccountAction(purpose: "invitation" | "password_reset" | undefined) {
  return async ({ token, password }: { token: string; password: string }) => {
      const path = purpose === 'invitation' ? 'accept-invitation' : 'reset-password'
      await client.post(`/api/auth/${path}`, { token, password })
    }
}
