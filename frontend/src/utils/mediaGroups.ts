import type { Message } from '../types'

/** Ventana entre fotos/videos consecutivos del mismo remitente para
 * agruparlos como un álbum cuando NO hay `album_id` explícito (ver abajo) —
 * o sea, todo lo que manda el cliente. No hay forma de reconstruir el álbum
 * real que llega de WhatsApp (`albumMessage`/`associatedChildMessage` no
 * traen contenido propio, ver docs/n8n-normalizacion-wsp-messages.md), así
 * que para lo entrante esto es un heurístico por tiempo: coincide con el
 * retraso máximo medido en producción entre el sobre del álbum y la imagen
 * real (ver `IGNORED_ORIGINAL_TYPES` en backend/services/automation_rules.py)
 * — el mismo pipeline de descarga/análisis puede introducir un retraso
 * similar entre las fotos reales de un mismo envío. */
const ALBUM_WINDOW_MS = 60_000

const GROUPABLE_TYPES = new Set(['image', 'video', 'ptv'])

function qualifies(message: Message): boolean {
  return !!message.message_type && GROUPABLE_TYPES.has(message.message_type) &&
    !message.deleted_at && !!message.sent_at
}

/** Id de álbum explícito: lo pone el propio CRM al mandar varias fotos/videos
 * juntos desde el mismo picker (ver ChatComposer), porque WhatsApp no tiene
 * forma de agrupar un álbum saliente (Evolution API no lo expone). Cuando
 * está presente reemplaza al heurístico de tiempo — es exacto, no una
 * adivinanza. */
function albumIdOf(message: Message): string | null {
  const value = message.payload?.album_id
  return typeof value === 'string' && value ? value : null
}

function continuesRun(message: Message, prev: Message): boolean {
  if (!qualifies(message)) return false
  const prevAlbumId = albumIdOf(prev)
  const messageAlbumId = albumIdOf(message)
  if (prevAlbumId || messageAlbumId) return prevAlbumId !== null && prevAlbumId === messageAlbumId
  return message.sender === prev.sender &&
    new Date(message.sent_at as string).getTime() - new Date(prev.sent_at as string).getTime() <= ALBUM_WINDOW_MS
}

/**
 * Corridas de 2+ fotos/videos consecutivos que forman un álbum: por
 * `album_id` explícito cuando lo hay (lo que mandó este mismo CRM), o si no
 * por el heurístico de tiempo/remitente (lo que llega del cliente). Se pintan
 * como una sola grilla en vez de burbujas separadas.
 *
 * Devuelve un mapa del id del PRIMER mensaje de cada grupo a la lista
 * completa (en orden) de mensajes del grupo. Un mensaje que califica pero
 * queda solo (sin vecino que lo agrupe) no entra en el mapa y sigue su
 * burbuja individual de siempre.
 */
export function groupAlbumMessages(messages: Message[]): Map<number, Message[]> {
  const groups = new Map<number, Message[]>()
  let run: Message[] = []

  function flush() {
    if (run.length >= 2) groups.set(run[0].id, run)
  }

  for (const message of messages) {
    const prev = run[run.length - 1]
    if (prev != null && continuesRun(message, prev)) {
      run.push(message)
      continue
    }
    flush()
    run = qualifies(message) ? [message] : []
  }
  flush()

  return groups
}

/** Ids de todos los mensajes que son miembros de algún grupo (incluido el
 * primero) — para saltear su burbuja individual en el hilo: ya la pinta la
 * grilla del grupo. */
export function albumMemberIds(groups: Map<number, Message[]>): Set<number> {
  const ids = new Set<number>()
  for (const group of groups.values()) {
    for (const message of group) ids.add(message.id)
  }
  return ids
}
