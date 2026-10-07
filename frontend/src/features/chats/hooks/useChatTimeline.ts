import { useMemo } from 'react'
import type { MediaLightboxItem } from '../../../shared/ui/MediaLightbox'
import { useLeadActivity } from '../../leads/public/useLeadMeta'
import type { InternalNote } from '../types'
import type { LeadActivity } from '../../leads/types'
import type { Message } from '../../whatsapp/types'
import { groupByDay, parseContent, resolveMediaUrl } from '../../whatsapp/public/message'
import { messageMediaFilename } from '../utils/messageMedia'
import { useInternalNotes } from './useInternalNotes'
import { useMessages } from './useMessages'

/** Todo lo que puede aparecer en el hilo. */
export type TimelineItem =
  | { kind: 'message'; key: string; sentAt: string | null; message: Message }
  | { kind: 'note'; key: string; sentAt: string; note: InternalNote }
  | { kind: 'activity'; key: string; sentAt: string; activity: LeadActivity }

/** Cuántos mensajes enviados se ofrecen para reenviar o guardar como plantilla. */
const SENT_HISTORY_LIMIT = 10

/**
 * Arma el hilo que se ve en pantalla a partir de las tres fuentes que lo
 * componen: los mensajes registrados, las notas internas y los cambios de
 * etapa del lead.
 *
 * Todo sale ordenado por fecha y agrupado por día, que es lo que permite fijar
 * el chip de fecha mientras se navega.
 */
export function useChatTimeline(chatId: string, highlightMessageId: number | null) {
  const {
    data: messagePages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(chatId, highlightMessageId)
  // Las páginas llegan desde la más reciente hacia atrás. Se invierte el
  // orden de páginas, pero se conserva el orden ascendente dentro de cada
  // página, para renderizar el historial de viejo a nuevo.
  const messages = useMemo(
    () => [...(messagePages?.pages ?? [])].reverse().flatMap((page) => page.items),
    [messagePages],
  )

  const { data: notes = [] } = useInternalNotes(chatId)
  const { data: leadActivity = [] } = useLeadActivity(chatId)

  const timeline = useMemo<TimelineItem[]>(() => [
    ...messages.map(message => ({
      kind: 'message' as const,
      key: `message-${message.id}`,
      sentAt: message.sent_at,
      message,
    })),
    ...notes.map(note => ({
      kind: 'note' as const,
      key: `note-${note.id}`,
      sentAt: note.created_at,
      note,
    })),
    // Cambios de estado del lead como eventos del hilo, en la posición
    // cronológica en que ocurrieron: los mensajes de arriba son el contexto
    // de por qué se movió.
    ...leadActivity
      .filter(item => item.event_type === 'stage_changed')
      .map(item => ({
        kind: 'activity' as const,
        key: `activity-${item.id}`,
        sentAt: item.created_at,
        activity: item,
      })),
  ].sort((a, b) => {
    const aTime = a.sentAt ? new Date(a.sentAt).getTime() : Number.MAX_SAFE_INTEGER
    const bTime = b.sentAt ? new Date(b.sentAt).getTime() : Number.MAX_SAFE_INTEGER
    if (aTime !== bTime) return aTime - bTime
    // Los lotes de plantillas pueden compartir milisegundo. Sus IDs de DB
    // preservan el orden de la outbox mejor que una comparación textual
    // ("message-10" quedaría antes de "message-9").
    if (a.kind === 'message' && b.kind === 'message' && a.message.id > 0 && b.message.id > 0) {
      return a.message.id - b.message.id
    }
    return a.key.localeCompare(b.key)
  }), [messages, notes, leadActivity])

  // Una sección por día: es lo que permite fijar el chip de fecha arriba
  // mientras se navega ese día y que el del día siguiente lo empuje al llegar.
  const daySections = useMemo(() => groupByDay(timeline), [timeline])

  const sentMessageHistory = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const message of [...messages].reverse()) {
      if (message.sender !== 'vendedor') continue
      const parsed = parseContent(message)
      if (parsed.kind !== 'text' || !parsed.text.trim() || seen.has(parsed.text.trim())) continue
      seen.add(parsed.text.trim()); result.push(parsed.text.trim())
      if (result.length === SENT_HISTORY_LIMIT) break
    }
    return result
  }, [messages])

  // Galería disponible para el hilo ya cargado. Conserva el orden real de
  // envío y mezcla imágenes y videos, como el visor multimedia de WhatsApp.
  const chatMediaItems = useMemo<MediaLightboxItem[]>(() => messages.flatMap(message => {
    const parsed = parseContent(message)
    if (parsed.kind !== 'image' && parsed.kind !== 'video') return []
    const src = resolveMediaUrl(message.media_url)
    if (!src) return []
    return [{
      src,
      kind: parsed.kind === 'image' ? 'image' : 'video',
      alt: parsed.text || (parsed.kind === 'image' ? 'Imagen' : 'Video'),
      filename: messageMediaFilename(message),
    }]
  }), [messages])

  return {
    messages,
    timeline,
    daySections,
    sentMessageHistory,
    chatMediaItems,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    pageCount: messagePages?.pages.length ?? 0,
    lastTimelineKey: timeline.at(-1)?.key ?? null,
  }
}
