import type { Chat } from '../types'

export function phoneFromChatId(chatId: string): string {
  const digits = chatId.split('@')[0]
  return `+${digits}`
}

export function displayName(chat: Chat): string {
  return chat.name ?? chat.phone ?? phoneFromChatId(chat.chat_id)
}

export function displayPhone(chat: Chat): string {
  return chat.phone ?? phoneFromChatId(chat.chat_id)
}

export function avatarInitial(chat: Chat): string {
  return chat.name?.[0]?.toUpperCase() ?? '#'
}

export type WaitingTier = 'fresh' | 'warning' | 'urgent'

// Umbrales pensados para respuesta de ventas por WhatsApp: a los 10 min sin
// contestar ya vale la pena llamar la atención (amarillo), y pasada 1 hora
// es un lead que se puede estar enfriando (rojo).
const WARNING_THRESHOLD_MS = 10 * 60_000
const URGENT_THRESHOLD_MS = 60 * 60_000

/** Un chat "espera respuesta" solo si el último mensaje lo mandó el cliente
 * — si el último mensaje es del vendedor, la pelota está del otro lado. */
export function isAwaitingReply(chat: Chat): boolean {
  return chat.last_message_sender === 'cliente' && chat.timestamp !== null
}

export function waitingTier(elapsedMs: number): WaitingTier {
  if (elapsedMs >= URGENT_THRESHOLD_MS) return 'urgent'
  if (elapsedMs >= WARNING_THRESHOLD_MS) return 'warning'
  return 'fresh'
}

/** Tiempo relativo compacto tipo "5m", "2h", "3d" — nunca "ahora" para no
 * competir con la hora absoluta que se ve en el resto de la lista. */
export function formatElapsedShort(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
