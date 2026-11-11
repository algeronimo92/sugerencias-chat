import type { Chat, MessageSearchHit } from '../leads/types'
import { displayName, displayUsername } from '../leads/public/chat'
import { highlightSegments, searchTerms } from '../whatsapp/public/message'

export interface ContactMatch {
  label: string
  value: string
}

function contains(text: string | null | undefined, term: string): boolean {
  return !!text && highlightSegments(text, term).some(segment => segment.match)
}

/**
 * Por qué un contacto aparece en el resultado, cuando el nombre que se ve en
 * la fila no lo explica.
 *
 * El buscador también mira el servicio de interés, la vendedora y el origen.
 * Antes esas filas mostraban solo el último mensaje del chat, sin nada de lo
 * buscado, y parecía que el buscador no había encontrado nada (queja de las
 * vendedoras, 2026-11-11). `null` = el nombre ya trae todas las palabras, o no
 * se puede saber desde la fila (matcheó por un identificador de WhatsApp).
 */
export function contactMatchReason(chat: Chat, search: string): ContactMatch | null {
  const shown = displayName(chat)
  const missing = searchTerms(search).filter(term => !contains(shown, term))
  if (missing.length === 0) return null

  const fields: [string, string | null | undefined][] = [
    ['Servicio', chat.servicio_interes],
    ['Asignado a', chat.vendedor],
    ['Origen', chat.origen],
    // Con usuario de WhatsApp, la fila muestra el usuario y no el nombre.
    ['Nombre', displayUsername(chat) ? chat.name : null],
    ['Teléfono', chat.phone],
    ['Otro teléfono', chat.secondary_phone],
  ]
  for (const [label, value] of fields) {
    if (value && missing.some(term => contains(value, term))) return { label, value }
  }

  // Un teléfono escrito con otro formato ("983 049 189" contra "+51983049189"):
  // el servidor compara solo dígitos.
  const digits = search.replace(/\D/g, '')
  if (digits.length >= 5) {
    for (const [label, value] of fields.slice(4)) {
      if (value && value.replace(/\D/g, '').includes(digits)) return { label, value }
    }
  }
  return null
}

/** Cómo se nombra al lead de un mensaje encontrado: usuario, nombre o
 *  teléfono, nunca el identificador interno. */
export function hitName(hit: MessageSearchHit): string {
  return displayUsername({ username: hit.username ?? null }) ?? (hit.name?.trim() || hit.phone?.trim() || 'Sin nombre')
}

/** La fecha de un mensaje encontrado, corta como en la lista de WhatsApp: la
 *  hora si fue hoy, "Ayer", el día de la semana si fue esta semana, o la fecha. */
export function formatHitDate(sentAt: string | null | undefined, now: Date = new Date()): string {
  if (!sentAt) return ''
  const date = new Date(sentAt)
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (daysAgo <= 0) return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
  if (daysAgo === 1) return 'Ayer'
  if (daysAgo < 7) return date.toLocaleDateString('es-PE', { weekday: 'long' })
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
