
export type { AuthUser } from '../../shared/types'

export interface PinStatus {
  available: boolean
  user_name?: string | null
  masked_email?: string | null
  device_name?: string | null
  locked_seconds: number
}

export interface AuthSession {
  id: string
  device_name: string
  auth_method: 'password' | 'pin'
  current: boolean
  created_at: string
  last_used_at: string
  absolute_expires_at: string
}

export interface LoginPayload {
  email: string
  password: string
  remember_device: boolean
  mfa_code?: string
}

export interface MfaStatus {
  enabled: boolean
  recovery_codes_remaining: number
}

export interface ActionTokenInfo {
  purpose: 'invitation' | 'password_reset'
  email: string
  name: string
}
