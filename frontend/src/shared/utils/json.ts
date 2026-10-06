import type { JsonObject, JsonValue } from '../types'

/** Un valor JSON que es un objeto (no una lista ni un primitivo). */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
