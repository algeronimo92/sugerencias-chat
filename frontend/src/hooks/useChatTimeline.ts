import { useEffect, useMemo, useState } from 'react'
import type { HistoryMessage, InternalNote, LeadActivity, Message } from '../types'
import { groupByDay, parseContent, resolveMediaUrl } from '../utils/message'
import type { MediaLightboxItem } from '../components/MediaLightbox'
import { useMessages } from './useMessages'
import { useEvolutionHistory, useEvolutionHistoryAvailability } from './useEvolutionHistory'
import { useInternalNotes } from './useInternalNotes'
import { useLeadActivity } from './useLeadMeta'

/** Todo lo que puede aparecer en el hilo, ya sea de la base o traído al vuelo. */
export type TimelineItem =
  | { kind: 'message'; key: string; sentAt: string | null; message: Message }
  | { kind: 'note'; key: string; sentAt: string; note: InternalNote }
  | { kind: 'activity'; key: string; sentAt: string; activity: LeadActivity }
  // Traído de WhatsApp al vuelo, sin registro en la base: siempre anterior a
  // cualquier mensaje propio, así que el orden por fecha lo deja arriba.
  | { kind: 'history'; key: string; sentAt: string; history: HistoryMessage }

/** Cuántos mensajes enviados se ofrecen para reenviar o guardar como plantilla. */
const SENT_HISTORY_LIMIT = 10

/**
 * Arma el hilo que se ve en pantalla a partir de las cuatro fuentes que lo
 * componen: los mensajes registrados, el historial que vive solo en WhatsApp,
 * las notas internas y los cambios de etapa del lead.
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

  // Historial de WhatsApp anterior al registro propio: se pide a mano, recién
  // cuando el usuario agotó los mensajes de la base y quiere ver más atrás.
  const [historyRequested, setHistoryRequested] = useState(false)
  const { data: historyAvailability } = useEvolutionHistoryAvailability()
  const oldestDbSentAt = messages.find(m => m.sent_at)?.sent_at ?? null
  const {
    data: historyPages,
    error: historyError,
    fetchNextPage: fetchNextHistoryPage,
    hasNextPage: hasMoreHistory,
    isFetching: isFetchingHistory,
    refetch: refetchHistory,
  } = useEvolutionHistory(chatId, oldestDbSentAt, historyRequested && !hasNextPage)
  const historyMessages = useMemo(() => {
    const registered = new Set(messages.map(m => m.wa_message_id).filter(Boolean))
    return [...(historyPages?.pages ?? [])]
      .reverse()
      .flatMap(page => page.items)
      .filter(item => !registered.has(item.wa_message_id))
  }, [historyPages, messages])

  // El historial de WhatsApp se vuelve a pedir a mano en cada chat: es caro
  // y casi siempre alcanza con lo que está registrado.
  useEffect(() => {
    setHistoryRequested(false)
  }, [chatId])

  const { data: notes = [] } = useInternalNotes(chatId)
  const { data: leadActivity = [] } = useLeadActivity(chatId)

  const timeline = useMemo<TimelineItem[]>(() => [
    ...historyMessages.map(history => ({
      kind: 'history' as const,
      key: `history-${history.wa_message_id}`,
      sentAt: history.sent_at,
      history,
    })),
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
  }), [messages, historyMessages, notes, leadActivity])

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
      kind: parsed.kind,
      alt: parsed.text || (parsed.kind === 'image' ? 'Imagen' : 'Video'),
    }]
  }), [messages])

  return {
    messages,
    historyMessages,
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
    // Historial de WhatsApp traído al vuelo
    historyAvailability,
    historyError,
    fetchNextHistoryPage,
    hasMoreHistory,
    isFetchingHistory,
    refetchHistory,
    historyRequested,
    setHistoryRequested,
    historyPageCount: historyPages?.pages.length ?? 0,
  }
}
