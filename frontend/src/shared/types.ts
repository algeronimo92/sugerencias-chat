export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject { [key: string]: JsonValue }

export type UserRole = 'admin' | 'vendedor'

export interface AuthUser {
  id: number
  email: string
  name: string
  role: UserRole
}
