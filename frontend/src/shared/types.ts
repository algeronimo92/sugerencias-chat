export type JsonPrimitive = string | number | boolean | null
import type { ApiSchemas, Delivered } from './http/contract'
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject { [key: string]: JsonValue }

export type UserRole = 'admin' | 'vendedor'

/** Usuario de la sesión. `role` llega como texto: el contrato no lo cierra
 * (los valores que el CRM conoce son los de `UserRole`). */
export type AuthUser = Delivered<ApiSchemas['UserOut']>
