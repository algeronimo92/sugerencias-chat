import { useEffect, useSyncExternalStore } from 'react'

/**
 * Registro de "estoy a medias": qué tiene el usuario en curso en esta pestaña
 * y, por una marca en localStorage, en las demás pestañas del CRM.
 *
 * No sabe nada de chats ni de flujos: cada feature marca su actividad con
 * `useActivityHold(kind, activa)` y quien decide algo delicado (hoy, recargar
 * la app para aplicar una versión nueva) pregunta si hay algo retenido. Se
 * hizo así porque la recarga vive fuera del router y de las features, y una
 * lista de flags en App habría que recordar actualizarla con cada pantalla.
 */

export type ActivityKind =
  | 'recording'
  | 'pending-media'
  | 'sending-media'
  | 'reply'
  | 'selection'
  | 'flow-editor'

const holds = new Map<ActivityKind, number>()
const listeners = new Set<() => void>()
let snapshot: ActivityKind[] = []

function emit() {
  snapshot = [...holds.keys()]
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Retiene `kind`; devuelve la función que lo suelta. Se puede retener el
 * mismo tipo desde varios sitios: se suelta cuando lo sueltan todos. */
export function hold(kind: ActivityKind): () => void {
  holds.set(kind, (holds.get(kind) ?? 0) + 1)
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (holds.get(kind) ?? 1) - 1
    if (count <= 0) holds.delete(kind)
    else holds.set(kind, count)
    emit()
  }
}

/** Qué hay retenido ahora, en orden de retención. */
export function activeHolds(): ActivityKind[] {
  return snapshot
}

export function useActiveHolds() {
  return useSyncExternalStore(subscribe, activeHolds, () => snapshot)
}

/** Retiene `kind` mientras `active` sea true. */
export function useActivityHold(kind: ActivityKind, active: boolean) {
  useEffect(() => {
    if (!active) return
    return hold(kind)
  }, [kind, active])
}

// ---- Entre pestañas -------------------------------------------------------
//
// Aplicar un service worker nuevo recarga todas las pestañas del CRM, no solo
// la que lo pidió. Cada pestaña con algo a medias deja una marca con fecha en
// localStorage y la renueva; otra pestaña la considera fresca si no pasó el
// triple del intervalo de renovación (una pestaña dormida o cerrada sin
// despedirse deja de bloquear sola).

const LEASE_PREFIX = 'pwa-activity:'
const TAB_ID_KEY = 'pwa-tab-id'
export const LEASE_RENEW_MS = 10_000
export const LEASE_FRESH_MS = LEASE_RENEW_MS * 3

function tabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(TAB_ID_KEY, fresh)
    return fresh
  } catch {
    return 'tab'
  }
}

function ownLeaseKey() {
  return LEASE_PREFIX + tabId()
}

/** ¿Otra pestaña del CRM tiene algo a medias? */
export function hasFreshForeignLease(now = Date.now()): boolean {
  try {
    const own = ownLeaseKey()
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key || !key.startsWith(LEASE_PREFIX) || key === own) continue
      const at = Number(localStorage.getItem(key))
      if (Number.isFinite(at) && now - at < LEASE_FRESH_MS) return true
    }
  } catch {
    // Sin localStorage no hay forma de saberlo: no se bloquea por eso.
  }
  return false
}

function writeOwnLease() {
  try {
    localStorage.setItem(ownLeaseKey(), String(Date.now()))
  } catch {
    // Sin localStorage las otras pestañas no se enteran; nada más que hacer.
  }
}

function clearOwnLease() {
  try {
    localStorage.removeItem(ownLeaseKey())
  } catch {
    // Idem.
  }
}

/** Mantiene la marca de esta pestaña mientras tenga algo retenido. Llamar
 * una sola vez; devuelve la función que deja de publicar y borra la marca. */
export function publishActivityLease(): () => void {
  let renewTimer: ReturnType<typeof setInterval> | null = null

  function sync() {
    if (holds.size > 0) {
      if (renewTimer) return
      writeOwnLease()
      renewTimer = setInterval(writeOwnLease, LEASE_RENEW_MS)
    } else {
      if (renewTimer) clearInterval(renewTimer)
      renewTimer = null
      clearOwnLease()
    }
  }

  sync()
  const unsubscribe = subscribe(sync)
  window.addEventListener('pagehide', clearOwnLease)
  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', clearOwnLease)
    if (renewTimer) clearInterval(renewTimer)
    clearOwnLease()
  }
}

/** Solo para tests. */
export function resetActivity() {
  holds.clear()
  listeners.clear()
  snapshot = []
}
