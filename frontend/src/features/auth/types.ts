
import type { ApiSchemas, Delivered } from '../../shared/http/contract'
export type { AuthUser } from '../../shared/types'

export interface PinStatus {
  available: boolean
  user_name?: string | null
  masked_email?: string | null
  device_name?: string | null
  locked_seconds: number
}

export type AuthSession = Delivered<ApiSchemas['SessionOut']>

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

export type ActionTokenInfo = Delivered<ApiSchemas['ActionTokenOut']>
