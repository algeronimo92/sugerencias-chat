import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, BotOff, ChevronDown, Copy, Database, Download, Forward, History, Loader2, MessageCircle, MessageCircleOff, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Chat, Message } from '../types'
import type { MessageTemplate } from '../types'
import {
  useDeleteMessage, useDeleteMessages, usePinMessage, usePinnedMessages, useReactToMessage,
  useSendMessage, useUnpinMessage, type ReplyTarget,
} from '../hooks/useMessages'
import { useUpdateLead } from '../hooks/useChats'
import { ForwardMessageDialog } from './ForwardMessageDialog'
import { HistoryMessageBubble } from './HistoryMessageBubble'
import { avatarInitial, displayName } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { formatDayLabel, formatMessageTime, parseContent } from '../utils/message'
import { albumMemberIds, groupAlbumMessages } from '../utils/mediaGroups'
import { messageMediaFilename, triggerMediaDownload } from '../utils/media'
import { AlbumBubble } from './AlbumBubble'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { MediaLightbox } from './MediaLightbox'
import { StickerPreviewDialog } from './StickerPreviewDialog'
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog'
import { TemplateSendDialog } from './TemplateSendDialog'
import { ChatComposer } from './ChatComposer'
import { MessageBubble, type OpenMedia } from './MessageBubble'
import { MessageEditDialog } from './MessageEditDialog'
import { InternalNoteComposer } from './InternalNoteComposer'
import { InternalNoteCard } from './InternalNoteCard'
import { useChatTimeline } from '../hooks/useChatTimeline'
import { useThreadScroll } from '../hooks/useThreadScroll'
import { StageChangeCard } from './StageChangeCard'
import { useMe } from '../hooks/useAuth'
import { useCustomerServiceWindow } from '../hooks/useCustomerServiceWindow'
import { CustomerServiceWindowBadge, CustomerServiceWindowNotice } from './CustomerServiceWindowStatus'
import { PinnedMessagesBar } from './PinnedMessagesBar'
import { LeadAutomationPanel } from './LeadAutomationPanel'

interface Props {
  chat: Chat
  /** Mensaje al que saltar y resaltar al abrir (desde un resultado de
   * búsqueda que matcheó por un mensaje del historial). */
  highlightMessageId?: number | null
  /** Solo en móvil, donde la lista y la conversación no conviven en pantalla. */
  onBack?: () => void
  /** En móvil y tablet las sugerencias no tienen columna propia: se abren
   * desde el header. Ausente en escritorio, donde el panel siempre está. */
  onOpenSuggestions?: () => void
}

/** Chip centrado con el día ("Hoy", "Ayer", la fecha), como WhatsApp: queda
 * fijado contra el borde superior mientras se navega ese día, y el chip del
 * día siguiente lo empuja hacia afuera al llegar. Ese empujón sale de que el
 * `sticky` está acotado por la caja de la sección del día, así que este
 * componente solo funciona como primer hijo de su sección.
 *
 * `pointer-events-none` deja pasar el mouse a las burbujas que pasan por
 * debajo: si no, el chip se comería el hover del botón de responder. */
function DaySeparator({ sentAt }: { sentAt: string }) {
  return (
    <div className="pointer-events-none sticky top-0 z-10 flex justify-center py-2">
      <span className="rounded-bubble bg-white px-3 py-1 text-[11px] font-medium text-wa-muted shadow-sm dark:bg-wa-head-dark dark:text-wa-muted-dark">
        {formatDayLabel(sentAt)}
      </span>
    </div>
  )
}

/** Marca dónde arranca lo que el sistema tiene guardado. Todo lo de arriba se
 * leyó de WhatsApp al vuelo y no está en la base: no se puede buscar, ni
 * citar, ni consultar sin conexión a la instancia. */
function DbRecordSeparator() {
  return (
    <div className="flex justify-center py-3">
      <span className="flex items-center gap-1.5 rounded-bubble border border-dashed border-wa-primary/50 bg-white px-3 py-1 text-[11px] font-medium text-wa-primary-strong shadow-sm dark:bg-wa-head-dark dark:text-wa-primary">
        <Database aria-hidden="true" className="h-3 w-3" />
        Desde acá hay registro en el sistema
      </span>
    </div>
  )
}

export function ChatThread({ chat, highlightMessageId = null, onBack, onOpenSuggestions }: Props) {
  const {
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
    pageCount,
    lastTimelineKey,
    historyAvailability,
    historyError,
    fetchNextHistoryPage,
    hasMoreHistory,
    isFetchingHistory,
    refetchHistory,
    historyRequested,
    setHistoryRequested,
    historyPageCount,
  } = useChatTimeline(chat.chat_id, highlightMessageId)

  const { data: me } = useMe()
  const { data: customerWindow, isLoading: isLoadingCustomerWindow } = useCustomerServiceWindow(chat.chat_id)
  const { mutate: updateLead, isPending: isUpdatingLead } = useUpdateLead(chat.chat_id)

  function toggleAutomation() {
    const next = !chat.automatizacion_pausada
    updateLead(
      { automatizacion_pausada: next },
      {
        onSuccess: () => toast.success(
          next
            ? 'Automatización en pausa: lo pendiente queda congelado'
            : 'Automatización reanudada desde donde había quedado'
        ),
        onError: (err) => toast.error(extractErrorMessage(err)),
      }
    )
  }

  function toggleConversation() {
    const next = !chat.conversacion_abierta
    updateLead(
      { conversacion_abierta: next },
      {
        onSuccess: () => toast.success(next ? 'Conversación abierta' : 'Conversación cerrada'),
        onError: (err) => toast.error(extractErrorMessage(err)),
      }
    )
  }

  const {
    threadRef,
    bottomRef,
    contentRef,
    threadWidth,
    flashMessageId,
    showScrollToBottom,
    hasNewWhileAway,
    handleMediaSettled,
    releaseAnchor,
    handleThreadScroll,
    scrollToBottom,
    goToQuotedMessage,
    loadOlder,
  } = useThreadScroll({
    chatId: chat.chat_id,
    highlightMessageId,
    isLoading,
    lastTimelineKey,
    timelineLength: timeline.length,
    pageCount,
    historyPageCount,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    historyError,
  })

  const [openMedia, setOpenMedia] = useState<OpenMedia | null>(null)
  const [previewSticker, setPreviewSticker] = useState<{ src: string; mediaUrl: string } | null>(null)
  const [templateContentToSave, setTemplateContentToSave] = useState<string | null>(null)
  const [messageToEdit, setMessageToEdit] = useState<Message | null>(null)
  const [multimediaTemplate, setMultimediaTemplate] = useState<MessageTemplate | null>(null)
  const [isNoteMode, setIsNoteMode] = useState(false)

  // Mensaje que se está respondiendo (cita estilo WhatsApp). Vale para todo
  // lo que salga del compositor: texto, audio, adjuntos y ubicación.
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [failedMediaIds, setFailedMediaIds] = useState<Set<number>>(new Set())
  const { mutate: sendMessage, retryMessage, discardMessage, error: sendError } = useSendMessage(chat.chat_id)
  const { mutate: reactToMessage } = useReactToMessage(chat.chat_id)
  const deleteMessage = useDeleteMessage(chat.chat_id)
  const deleteMessages = useDeleteMessages(chat.chat_id)

  // Selección múltiple estilo WhatsApp: se abre manteniendo apretada una
  // burbuja (o desde el botón del hover) y habilita copiar, reenviar y
  // eliminar sobre varios mensajes a la vez.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const isSelecting = selectedIds.size > 0
  // Mensajes a reenviar: la selección múltiple, o el mensaje suelto desde el
  // botón de su burbuja. null = el diálogo está cerrado.
  const [messageIdsToForward, setMessageIdsToForward] = useState<number[] | null>(null)

  function toggleSelected(messageId: number) {
    setSelectedIds(current => {
      const next = new Set(current)
      if (!next.delete(messageId)) next.add(messageId)
      return next
    })
  }

  /** Tildar/destildar un álbum entero de una sola vez: si ya está completo se
   * destilda entero, si no se completa — nunca queda "a medias" con un toque. */
  function toggleSelectedGroup(messageIds: number[]) {
    setSelectedIds(current => {
      const next = new Set(current)
      const allSelected = messageIds.every(id => next.has(id))
      for (const id of messageIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  // Fotos/videos consecutivos del mismo remitente enviados como un lote
  // (álbum de WhatsApp): se pintan como una sola grilla en vez de burbujas
  // separadas. Ver utils/mediaGroups para el heurístico.
  const albumGroups = useMemo(() => groupAlbumMessages(messages), [messages])
  const albumMembers = useMemo(() => albumMemberIds(albumGroups), [albumGroups])

  // Fijado nativo del CRM: no hay forma de mandarlo hacia WhatsApp (ni
  // Evolution API ni Baileys lo exponen), así que vive en su propio endpoint
  // — un fijado puede estar fuera de la página del hilo que está cargada.
  const { data: pinnedMessages = [] } = usePinnedMessages(chat.chat_id)
  const [pinnedIndex, setPinnedIndex] = useState(0)
  const { mutate: pinMessage } = usePinMessage(chat.chat_id)
  const { mutate: unpinMessage } = useUnpinMessage(chat.chat_id)

  function handlePin(messageId: number) {
    pinMessage(messageId, {
      onError: (err) => toast.error(extractErrorMessage(err)),
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // En el orden del hilo, no en el que se fueron tildando: es el orden en que
  // se copian y se reenvían.
  const selectedMessages = messages.filter(message => selectedIds.has(message.id))
  // "Eliminar para todos" solo aplica a los mensajes propios ya confirmados en
  // WhatsApp; el resto de la selección se ignora, como hace WhatsApp.
  const deletableSelection = selectedMessages.filter(
    message => message.sender === 'vendedor' && !!message.wa_message_id && !message.deleted_at,
  )
  const downloadableSelection = selectedMessages.filter(
    message => !!message.media_url && message.message_type !== 'view_once' && !message.deleted_at,
  )

  function downloadMessageMedia(message: Message) {
    if (!message.media_url || message.message_type === 'view_once' || message.deleted_at) return
    triggerMediaDownload(message.media_url, messageMediaFilename(message))
    toast.success('Descarga iniciada')
  }

  function downloadSelection() {
    if (!downloadableSelection.length) return
    downloadableSelection.forEach(message => {
      triggerMediaDownload(message.media_url as string, messageMediaFilename(message))
    })
    toast.success(downloadableSelection.length === 1
      ? 'Descarga iniciada'
      : `${downloadableSelection.length} descargas iniciadas`)
    clearSelection()
  }

  function removeMessage(message: Message) {
    deleteMessage.mutate(message.id, {
      onSuccess: () => toast.success('Mensaje eliminado para todos'),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  /** Copia la selección al portapapeles. Un solo mensaje se copia pelado (es
   * lo que se espera al copiar para pegar en otro lado); con varios se
   * antepone hora y autor, como el "Copiar" de WhatsApp. */
  async function copySelection() {
    const lines = selectedMessages.map(message => {
      const parsed = parseContent(message)
      // Un adjunto sin epígrafe no tiene texto que copiar: va su tipo
      // ("Imagen", "Audio"), como el "<multimedia omitido>" de WhatsApp.
      const body = parsed.text.trim() || parsed.label || 'Mensaje'
      if (selectedMessages.length === 1) return body
      const author = message.sender === 'vendedor' ? 'Vos' : displayName(chat)
      return `[${formatMessageTime(message.sent_at)}] ${author}: ${body}`
    })
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success(lines.length === 1 ? 'Mensaje copiado' : `${lines.length} mensajes copiados`)
      clearSelection()
    } catch {
      toast.error('El navegador no dejó copiar al portapapeles')
    }
  }

  function deleteSelection() {
    if (!deletableSelection.length) return
    deleteMessages.mutate(deletableSelection.map(message => message.id), {
      onSuccess: ({ deleted, failed }) => {
        if (deleted) toast.success(`${deleted} mensaje(s) eliminados para todos`)
        if (failed) toast.error(`${failed} mensaje(s) no se pudieron eliminar`)
        clearSelection()
      },
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  // Escape cierra el modo selección, como cualquier otra capa de la interfaz.
  useEffect(() => {
    if (!isSelecting) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSelecting])


  // El foco del cursor lo pone el compositor al ver la cita nueva: el
  // textarea es suyo, no de acá.
  function startReply(message: Message) {
    setReplyTo({ id: message.id, sender: message.sender, content: message.content })
    setIsNoteMode(false)
  }

  // El draft y los errores de envío son por chat: al cambiar de lead no debe
  // quedar pegado el texto ni el error del chat anterior.
  // La cita y el modo nota son del hilo, no del compositor: los inicia una
  // burbuja. Al cambiar de lead no deben quedar pegados.
  useEffect(() => {
    setReplyTo(null)
    setIsNoteMode(false)
    setMessageToEdit(null)
    setSelectedIds(new Set())
    setMessageIdsToForward(null)
  }, [chat.chat_id])

  function handleRetryMessage(message: Message) {
    if (!message.content?.trim()) return
    retryMessage(message)
  }

  return (
    <div className="relative flex flex-col h-full bg-wa-chat dark:bg-wa-chat-dark">
      {/* Barra de selección: reemplaza al header mientras hay mensajes
          tildados, igual que WhatsApp. */}
      {isSelecting ? (
        <div className="flex h-16 shrink-0 items-center justify-between gap-1 border-b border-wa-border bg-wa-head px-1.5 py-2.5 sm:gap-2 sm:px-4 dark:border-wa-border-dark dark:bg-wa-head-dark">
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Cancelar selección"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 sm:h-11 sm:w-11 dark:text-wa-muted-dark dark:hover:bg-white/5"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
              {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <button
              type="button"
              onClick={() => void copySelection()}
              aria-label="Copiar mensajes seleccionados"
              title="Copiar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 sm:h-11 sm:w-11 dark:text-wa-muted-dark dark:hover:bg-white/5"
            >
              <Copy className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={downloadSelection}
              disabled={!downloadableSelection.length}
              aria-label="Descargar multimedia seleccionada"
              title={downloadableSelection.length ? 'Descargar multimedia' : 'La selección no contiene multimedia'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-35 sm:h-11 sm:w-11 dark:text-wa-muted-dark dark:hover:bg-white/5"
            >
              <Download className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setMessageIdsToForward(selectedMessages.map(message => message.id))}
              aria-label="Reenviar mensajes seleccionados"
              title="Reenviar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 sm:h-11 sm:w-11 dark:text-wa-muted-dark dark:hover:bg-white/5"
            >
              <Forward className="h-5 w-5" />
            </button>
            <ConfirmDialog
              title="Eliminar mensajes para todos"
              description={
                deletableSelection.length === selectedIds.size
                  ? 'Los mensajes desaparecerán también del WhatsApp del cliente, que verá "Se eliminó este mensaje". No se puede deshacer.'
                  : `De los ${selectedIds.size} seleccionados solo se pueden eliminar ${deletableSelection.length}: WhatsApp únicamente permite borrar para todos los mensajes propios ya enviados. No se puede deshacer.`
              }
              confirmLabel="Eliminar para todos"
              disabled={!deletableSelection.length || deleteMessages.isPending}
              onConfirm={deleteSelection}
            >
              <button
                type="button"
                disabled={!deletableSelection.length || deleteMessages.isPending}
                aria-busy={deleteMessages.isPending}
                aria-label="Eliminar mensajes seleccionados para todos"
                title={deletableSelection.length ? 'Eliminar para todos' : 'Ninguno de los mensajes seleccionados se puede eliminar'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 sm:h-11 sm:w-11 dark:text-wa-muted-dark dark:hover:bg-white/5 dark:hover:text-red-400"
              >
                {deleteMessages.isPending
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : <Trash2 className="h-5 w-5" />}
              </button>
            </ConfirmDialog>
          </div>
        </div>
      ) : (
      /* Header — gris claro / #202C33, como el header de conversación de WhatsApp */
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-wa-border bg-wa-head px-2 py-2.5 sm:px-4 dark:border-wa-border-dark dark:bg-wa-head-dark">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Volver a la lista de chats"
              className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {avatarInitial(chat)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">{displayName(chat)}</p>
            <CustomerServiceWindowBadge data={customerWindow} isLoading={isLoadingCustomerWindow} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleConversation}
            disabled={isUpdatingLead}
            aria-label={chat.conversacion_abierta ? 'Cerrar conversación' : 'Abrir conversación'}
            title={chat.conversacion_abierta ? 'Conversación abierta — tocá para cerrarla' : 'Conversación cerrada — tocá para abrirla'}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
              chat.conversacion_abierta
                ? 'text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/30'
                : 'text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
            }`}
          >
            {chat.conversacion_abierta ? <MessageCircle className="h-5 w-5" /> : <MessageCircleOff className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={toggleAutomation}
            disabled={isUpdatingLead}
            aria-label={chat.automatizacion_pausada ? 'Reanudar automatización de este chat' : 'Pausar automatización de este chat'}
            title={chat.automatizacion_pausada
              ? 'En pausa — tocá para reanudar: lo congelado sigue desde donde quedó'
              : 'Automatización activa — tocá para congelar lo pendiente de este chat'}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
              chat.automatizacion_pausada
                ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                : 'text-wa-muted hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5'
            }`}
          >
            {chat.automatizacion_pausada ? <BotOff className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
          </button>
          {onOpenSuggestions && (
            <button
              type="button"
              onClick={onOpenSuggestions}
              aria-label="Ver sugerencias del lead"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
            >
              <Sparkles className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      )}

      {!isNoteMode && pinnedMessages.length > 0 && (
        <PinnedMessagesBar
          pinned={pinnedMessages}
          activeIndex={pinnedIndex}
          onSelectIndex={setPinnedIndex}
          onJump={goToQuotedMessage}
          onUnpin={(messageId) => unpinMessage(messageId)}
        />
      )}

      {/* Thread — el wrapper relativo permite flotar el botón "ir al final"
          por fuera del scroll, así no se desplaza con el contenido. */}
      <div className="relative flex-1 min-h-0">
      <div
        ref={threadRef}
        onScroll={handleThreadScroll}
        onLoadCapture={handleMediaSettled}
        onLoadedMetadataCapture={handleMediaSettled}
        onWheelCapture={releaseAnchor}
        onTouchMoveCapture={releaseAnchor}
        className="h-full overflow-y-auto px-3 py-4 sm:px-6"
      >
      {/* El observer mide este div (no el scroller): su alto es el del
          contenido real, que es lo que cambia cuando la media asienta. */}
      <div ref={contentRef} className="flex flex-col">
        {isLoading && (
          <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center py-8">Cargando mensajes...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">Error al cargar mensajes.</p>
        )}
        {!isLoading && !error && timeline.length === 0 && (
          <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center py-8">Sin mensajes en este chat.</p>
        )}
        {!isLoading && !error && hasNextPage && (
          <button type="button"
            onClick={() => { if (!isFetchingNextPage) loadOlder(fetchNextPage) }}
            disabled={isFetchingNextPage}
            className="mx-auto my-2 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-wa-muted shadow-sm hover:bg-wa-hover disabled:cursor-wait dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
          >
            {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isFetchingNextPage ? 'Cargando anteriores...' : 'Cargar mensajes anteriores'}
          </button>
        )}
        {/* Con la base agotada, lo anterior solo existe en WhatsApp. Se ofrece
            traerlo a mano: cada pedido cuesta varias llamadas a Evolution y no
            es lo que se necesita en la mayoría de los chats. */}
        {!isLoading && !error && !hasNextPage && historyAvailability?.available && (
          <div className="my-2 flex flex-col items-center gap-1.5">
            {historyError && (
              <p className="text-center text-xs text-red-500 dark:text-red-400">
                No se pudo traer el historial de WhatsApp. {extractErrorMessage(historyError)}
              </p>
            )}
            {isFetchingHistory ? (
              <span className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-wa-muted shadow-sm dark:bg-wa-head-dark dark:text-wa-muted-dark">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Buscando historial de WhatsApp...
              </span>
            ) : !historyRequested ? (
              <button type="button"
                onClick={() => loadOlder(async () => {
                  setHistoryRequested(true)
                  return { isError: false }
                })}
                className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-wa-muted shadow-sm hover:bg-wa-hover dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
              >
                <History className="h-3.5 w-3.5" />
                Ver historial anterior de WhatsApp
              </button>
            ) : historyError ? (
              <button type="button"
                onClick={() => loadOlder(refetchHistory)}
                className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-wa-muted shadow-sm hover:bg-wa-hover dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reintentar
              </button>
            ) : hasMoreHistory ? (
              <button type="button"
                onClick={() => loadOlder(fetchNextHistoryPage)}
                className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-wa-muted shadow-sm hover:bg-wa-hover dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
              >
                <History className="h-3.5 w-3.5" />
                Cargar más historial de WhatsApp
              </button>
            ) : (
              <span className="text-center text-xs text-wa-muted dark:text-wa-muted-dark">
                {historyMessages.length > 0
                  ? 'Inicio del historial de WhatsApp'
                  : 'No hay historial anterior en WhatsApp'}
              </span>
            )}
          </div>
        )}
        {/* Sin historial cargado, el chat empieza donde empieza el registro:
            la marca va arriba de todo. Con historial cargado la dibuja el
            propio hilo, en el límite entre lo traído y lo guardado. */}
        {!isLoading && !error && !hasNextPage && messages.length > 0 && historyMessages.length === 0 && (
          <DbRecordSeparator />
        )}
        {daySections.map((section) => (
          // La sección acota el sticky del chip: sin este contenedor todos los
          // chips se apilarían pegados arriba en vez de reemplazarse.
          <div key={section.key} className="flex flex-col">
            {section.sentAt && <DaySeparator sentAt={section.sentAt} />}
            {section.items.map(({ item, globalIndex }, indexInSection) => {
              const isFirstOfSection = indexInSection === 0
              const prevItem = globalIndex > 0 ? timeline[globalIndex - 1] : null
              // El primer ítem registrado después del historial de WhatsApp es
              // justo donde arranca lo que guarda el sistema.
              const showDbBoundary = item.kind !== 'history' && prevItem?.kind === 'history'
              // Miembro de un álbum que no es el primero: ya lo pinta la
              // grilla de AlbumBubble más arriba, esta burbuja se salta.
              if (item.kind === 'message' && albumMembers.has(item.message.id) && !albumGroups.has(item.message.id)) {
                return null
              }
              if (item.kind === 'history') {
                return (
                  <HistoryMessageBubble
                    key={item.key}
                    message={item.history}
                    isFirstOfGroup={
                      isFirstOfSection ||
                      prevItem?.kind !== 'history' ||
                      prevItem.history.sender !== item.history.sender
                    }
                  />
                )
              }
              if (item.kind === 'activity') {
                return (
                  <Fragment key={item.key}>
                    {showDbBoundary && <DbRecordSeparator />}
                    <StageChangeCard activity={item.activity} />
                  </Fragment>
                )
              }
              if (item.kind === 'note') {
                return (
                  <Fragment key={item.key}>
                    {showDbBoundary && <DbRecordSeparator />}
                    <div className="my-2">
                      <InternalNoteCard
                        chatId={chat.chat_id}
                        note={item.note}
                        canManage={me?.role === 'admin' || me?.id === item.note.author_user_id}
                      />
                    </div>
                  </Fragment>
                )
              }
              const group = albumGroups.get(item.message.id)
              if (group) {
                const groupIds = group.map(m => m.id)
                return (
                  <Fragment key={item.key}>
                    {showDbBoundary && <DbRecordSeparator />}
                    <AlbumBubble
                      messages={group}
                      isFirstOfGroup={
                        isFirstOfSection ||
                        !prevItem ||
                        prevItem.kind !== 'message' ||
                        prevItem.message.sender !== item.message.sender
                      }
                      failedMediaIds={failedMediaIds}
                      onMediaFailed={(id) => setFailedMediaIds((prev) => new Set(prev).add(id))}
                      onOpenMedia={setOpenMedia}
                      onRetry={() => handleRetryMessage(group[group.length - 1])}
                      onDiscard={() => discardMessage(group[group.length - 1])}
                      onForwardAll={() => setMessageIdsToForward(groupIds)}
                      onDownloadAll={() => group.forEach(downloadMessageMedia)}
                      selectionMode={isSelecting}
                      isSelected={groupIds.every(id => selectedIds.has(id))}
                      onToggleSelect={() => toggleSelectedGroup(groupIds)}
                    />
                  </Fragment>
                )
              }
              return (
                <Fragment key={item.key}>
                  {showDbBoundary && <DbRecordSeparator />}
                  <MessageBubble
                    chat={chat}
                    message={item.message}
                    chatMessages={messages}
                    isFirstOfGroup={
                      isFirstOfSection ||
                      !prevItem ||
                      prevItem.kind !== 'message' ||
                      prevItem.message.sender !== item.message.sender
                    }
                    isFlashing={flashMessageId === item.message.id}
                    threadWidth={threadWidth}
                    hasFailedMedia={failedMediaIds.has(item.message.id)}
                    onMediaFailed={() => setFailedMediaIds((prev) => new Set(prev).add(item.message.id))}
                    onOpenMedia={setOpenMedia}
                    onPreviewSticker={setPreviewSticker}
                    onQuotedJump={goToQuotedMessage}
                    onRetry={() => handleRetryMessage(item.message)}
                    onDiscard={() => discardMessage(item.message)}
                    onStartReply={() => startReply(item.message)}
                    onReact={(emoji) => reactToMessage(
                      { messageId: item.message.id, emoji },
                      { onError: (err) => toast.error(extractErrorMessage(err)) },
                    )}
                    onEdit={() => setMessageToEdit(item.message)}
                    onDelete={() => removeMessage(item.message)}
                    onForward={() => setMessageIdsToForward([item.message.id])}
                    onDownload={() => downloadMessageMedia(item.message)}
                    isDeleting={deleteMessage.isPending && deleteMessage.variables === item.message.id}
                    onPin={() => handlePin(item.message.id)}
                    onUnpin={() => unpinMessage(item.message.id)}
                    onSaveTemplate={setTemplateContentToSave}
                    selectionMode={isSelecting}
                    isSelected={selectedIds.has(item.message.id)}
                    onToggleSelect={() => toggleSelected(item.message.id)}
                  />
                </Fragment>
              )
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      </div>

      <button
        type="button"
        onClick={scrollToBottom}
        aria-label="Ir al último mensaje"
        title="Ir al último mensaje"
        aria-hidden={!showScrollToBottom}
        tabIndex={showScrollToBottom ? 0 : -1}
        className={`absolute bottom-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-wa-border bg-white text-wa-muted shadow-md transition-all duration-200 ease-out hover:bg-wa-hover active:bg-wa-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark ${
          showScrollToBottom ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'
        }`}
      >
        <ChevronDown aria-hidden="true" className="h-5 w-5" />
        {hasNewWhileAway && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-wa-primary ring-2 ring-white dark:ring-wa-head-dark"
          />
        )}
      </button>
      </div>

      {/* Compose */}
      <LeadAutomationPanel chatId={chat.chat_id} />
      {!isNoteMode && <CustomerServiceWindowNotice data={customerWindow} />}
      {isNoteMode ? (
        <InternalNoteComposer
          chatId={chat.chat_id}
          onCancel={() => setIsNoteMode(false)}
          onCreated={() => setIsNoteMode(false)}
        />
      ) : (
        <ChatComposer
          chat={chat}
          sentMessageHistory={sentMessageHistory}
          replyTo={replyTo}
          onReplyChange={setReplyTo}
          onQuotedJump={goToQuotedMessage}
          onSwitchToNote={() => setIsNoteMode(true)}
          onSaveTemplate={setTemplateContentToSave}
          onSendMultimediaTemplate={setMultimediaTemplate}
          sendMessage={sendMessage}
          sendError={sendError}
        />
      )}

      {openMedia && (
        <MediaLightbox
          src={openMedia.src}
          kind={openMedia.kind}
          alt={openMedia.alt}
          filename={openMedia.filename}
          items={chatMediaItems}
          onClose={() => setOpenMedia(null)}
        />
      )}

      {previewSticker && (
        <StickerPreviewDialog
          mediaSrc={previewSticker.src}
          mediaUrl={previewSticker.mediaUrl}
          onClose={() => setPreviewSticker(null)}
        />
      )}


      {templateContentToSave && (
        <SaveAsTemplateDialog content={templateContentToSave} onClose={() => setTemplateContentToSave(null)} />
      )}

      {messageToEdit && (
        <MessageEditDialog
          chatId={chat.chat_id}
          message={messageToEdit}
          onClose={() => setMessageToEdit(null)}
        />
      )}

      {multimediaTemplate && (
        <TemplateSendDialog chat={chat} template={multimediaTemplate} onClose={() => setMultimediaTemplate(null)} />
      )}

      {messageIdsToForward && (
        <ForwardMessageDialog
          chatId={chat.chat_id}
          messageIds={messageIdsToForward}
          onClose={() => setMessageIdsToForward(null)}
          onForwarded={clearSelection}
        />
      )}
    </div>
  )
}
