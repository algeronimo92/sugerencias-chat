import { useCallback, useSyncExternalStore } from 'react'

/**
 * Borradores del compositor, uno por chat.
 *
 * Antes el texto vivía en el estado del compositor y se vaciaba al cambiar de
 * lead: el vendedor que saltaba a otro chat a mirar un dato perdía lo que
 * estaba escribiendo. Se guarda en localStorage para que sobreviva también a
 * una recarga. Cada negocio tiene su propio subdominio, así que el origen (y
 * por lo tanto este almacenamiento) ya está separado por tenant.
 */

const STORAGE_KEY = 'chat-drafts:v1'
/** Tope para que un equipo que atiende cientos de chats no acumule basura. */
const MAX_DRAFTS = 100

interface StoredDraft { text: string; at: number }

const listeners = new Set<() => void>()
let drafts: Map<string, StoredDraft> | null = null

function load(): Map<string, StoredDraft> {
  if (drafts) return drafts
  drafts = new Map()
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Record<string, StoredDraft> | null
    if (parsed && typeof parsed === 'object') {
      for (const [chatId, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.text === 'string' && entry.text) drafts.set(chatId, { text: entry.text, at: Number(entry.at) || 0 })
      }
    }
  } catch {
    // localStorage bloqueado (modo privado) o valor corrupto: borradores solo en memoria.
  }
  return drafts
}

function persist(map: Map<string, StoredDraft>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)))
  } catch {
    // Sin almacenamiento el borrador sigue vivo mientras la pestaña esté abierta.
  }
}

export function getDraft(chatId: string): string {
  return load().get(chatId)?.text ?? ''
}

export function setDraftText(chatId: string, text: string) {
  const map = load()
  if (text === getDraft(chatId)) return
  if (text) {
    map.delete(chatId)
    map.set(chatId, { text, at: Date.now() })
    // El Map conserva el orden de inserción: los primeros son los más viejos.
    while (map.size > MAX_DRAFTS) map.delete(map.keys().next().value as string)
  } else {
    map.delete(chatId)
  }
  persist(map)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Otra pestaña del mismo negocio editó un borrador: se recarga desde disco.
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return
    drafts = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Solo para tests: olvida el caché en memoria. */
export function resetDraftsForTests() {
  drafts = null
}

type DraftUpdate = string | ((current: string) => string)

/** El borrador del chat, con la misma forma que `useState`. */
export function useChatDraft(chatId: string): [string, (update: DraftUpdate) => void] {
  const draft = useSyncExternalStore(subscribe, () => getDraft(chatId))
  const setDraft = useCallback(
    (update: DraftUpdate) => setDraftText(chatId, typeof update === 'function' ? update(getDraft(chatId)) : update),
    [chatId],
  )
  return [draft, setDraft]
}
