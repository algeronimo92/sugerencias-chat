/**
 * Reglas de la sección "Citas en la agenda del ERP" de Integraciones: qué se
 * puede probar y cuándo se deja guardar. Encender el envío, o cambiar a dónde
 * se envía estando encendido, exige una prueba exitosa de esos mismos datos;
 * apagarlo no exige nada.
 */

export interface SavedConnection {
  enabled: boolean
  url: string
  tokenConfigured: boolean
}

export interface ConnectionDraft {
  enabled: boolean
  url: string
  /** Vacío: se conserva el token guardado. */
  token: string
}

export interface ConnectionRules {
  /** Hay algo distinto de lo guardado. */
  dirty: boolean
  /** Lo que se quiere guardar tiene que probarse antes. */
  needsTest: boolean
  /** Hay dirección válida y un token (escrito o guardado) con qué probar. */
  canTest: boolean
  /** Identifica lo probado: una prueba solo vale para estos mismos datos. */
  key: string
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(value)
}

export function connectionRules(saved: SavedConnection, draft: ConnectionDraft): ConnectionRules {
  const url = draft.url.trim()
  const token = draft.token.trim()
  const connectionChanged = url !== saved.url || token !== ''
  return {
    dirty: draft.enabled !== saved.enabled || connectionChanged,
    needsTest: draft.enabled && (connectionChanged || !saved.enabled),
    canTest: looksLikeUrl(url) && (token !== '' || saved.tokenConfigured),
    key: `${url}|${token}`,
  }
}

/** Se puede guardar: hay cambios y, si hacía falta probarlos, la prueba pasó. */
export function canSaveConnection(rules: ConnectionRules, tested: boolean): boolean {
  return rules.dirty && (!rules.needsTest || tested)
}
