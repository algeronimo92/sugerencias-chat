import { useSyncExternalStore } from 'react'

/**
 * Estado compartido de la actualización de la PWA.
 *
 * Existe porque `PwaUpdatePrompt` se monta fuera del router (para registrar el
 * service worker aunque la sesión no esté resuelta) y por eso no puede saber
 * en qué chat está el usuario; y porque la cabecera necesita mostrar que hay
 * un build pendiente sin ser quien lo detectó. Incidente que lo motivó: el
 * 2026-11-09 una pestaña abierta siguió sirviendo el build anterior con el
 * worker nuevo en `waiting`, y el único aviso era un toast que, descartado, no
 * volvía hasta una hora después.
 */

type Listener = () => void

let updatePending = false
let currentChatId: string | null = null
let applyUpdate: (() => void) | null = null

const pendingListeners = new Set<Listener>()
const chatListeners = new Set<Listener>()

function subscribeTo(listeners: Set<Listener>) {
  return (listener: Listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

const subscribePending = subscribeTo(pendingListeners)
const subscribeChat = subscribeTo(chatListeners)

/** Lo escribe el prompt cuando el worker nuevo queda esperando. */
export function setPwaUpdatePending(value: boolean) {
  if (updatePending === value) return
  updatePending = value
  pendingListeners.forEach(listener => listener())
}

/** Hay un build nuevo esperando a que el usuario lo aplique. */
export function usePwaUpdatePending() {
  return useSyncExternalStore(subscribePending, () => updatePending, () => false)
}

/** Lo escribe la pantalla de chats; `null` fuera de un chat. */
export function setPwaCurrentChatId(chatId: string | null) {
  if (currentChatId === chatId) return
  currentChatId = chatId
  chatListeners.forEach(listener => listener())
}

export function usePwaCurrentChatId() {
  return useSyncExternalStore(subscribeChat, () => currentChatId, () => null)
}

/** El prompt registra cómo se aplica la actualización; el chip de la
 * cabecera solo la dispara. */
export function registerPwaUpdater(apply: (() => void) | null) {
  applyUpdate = apply
}

export function applyPwaUpdate() {
  applyUpdate?.()
}

/** Solo para tests: deja el store como al cargar la página. */
export function resetPwaUpdateStore() {
  updatePending = false
  currentChatId = null
  applyUpdate = null
  pendingListeners.clear()
  chatListeners.clear()
}
