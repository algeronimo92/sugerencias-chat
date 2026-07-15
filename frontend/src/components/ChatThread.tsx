import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, Check, CheckCheck, FileText, Loader2, Maximize2, MessageSquareLock, RefreshCw, Send } from 'lucide-react'
import type { Chat, InternalNote, Message, MessageStatus } from '../types'
import type { MessageTemplate } from '../types'
import { useMessages, useSendAudio, useSendLocation, useSendMedia, useSendMessage } from '../hooks/useMessages'
import { useRecordTemplateUse, useTemplates } from '../hooks/useTemplates'
import { avatarInitial, displayName } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { formatDayLabel, formatMessageTime, parseContent, parseRichText, resolveMediaUrl } from '../utils/message'
import { renderTemplate } from '../utils/templates'
import { AttachMenu } from './AttachMenu'
import { LocationConfirmDialog } from './LocationConfirmDialog'
import { MapPreview } from './MapPreview'
import { MediaLightbox } from './MediaLightbox'
import { VoiceRecorder } from './VoiceRecorder'
import { TemplatePicker } from './TemplatePicker'
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog'
import { TemplateSendDialog } from './TemplateSendDialog'
import { InternalNoteComposer } from './InternalNoteComposer'
import { InternalNoteCard } from './InternalNoteCard'
import { useInternalNotes } from '../hooks/useInternalNotes'
import { useMe } from '../hooks/useAuth'
import { useCustomerServiceWindow, useIsCustomerServiceWindowOpen } from '../hooks/useCustomerServiceWindow'
import { CustomerServiceWindowBadge, CustomerServiceWindowNotice } from './CustomerServiceWindowStatus'

const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
const MEDIA_ACCEPT = 'image/*,video/*'
const AUDIO_ACCEPT = 'audio/*'

const DOCUMENT_COLORS: Record<string, string> = {
  pdf: 'bg-red-500',
  doc: 'bg-blue-500',
  docx: 'bg-blue-500',
  xls: 'bg-green-600',
  xlsx: 'bg-green-600',
  ppt: 'bg-orange-500',
  pptx: 'bg-orange-500',
  txt: 'bg-gray-500',
  zip: 'bg-yellow-600',
}

function documentExtension(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop() : undefined
  return ext ? ext.toUpperCase() : 'ARCHIVO'
}

function documentColor(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined
  return (ext && DOCUMENT_COLORS[ext]) || 'bg-gray-500'
}

// Los navegadores solo saben previsualizar PDF de forma nativa; Word/Excel/etc.
// no tienen visor propio y si se abren con target="_blank" el navegador no
// sabe qué hacer con el archivo (peor, .docx/.xlsx son un ZIP por dentro, así
// que a veces terminan "abriéndose" como zip). Para esos, forzar la descarga
// directa es lo correcto.
function isPdfFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf')
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** GeolocationPositionError trae códigos fijos (1/2/3); cada uno tiene una
 * causa y solución distinta, igual que hicimos con los errores de micrófono. */
function describeGeolocationError(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return (
      'El navegador tiene bloqueado el acceso a la ubicación para este sitio. ' +
      'Para habilitarlo: hacé click en el ícono de candado (o de información) a la ' +
      'izquierda de la URL → "Permisos del sitio" → Ubicación → Permitir, y volvé a cargar la página.'
    )
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    return 'No se pudo determinar tu ubicación actual.'
  }
  if (err.code === err.TIMEOUT) {
    return 'Se agotó el tiempo esperando la ubicación. Intentá de nuevo.'
  }
  return 'No se pudo obtener la ubicación.'
}

interface Props {
  chat: Chat
  onRefreshSuggestions: () => void
}

interface OpenMedia {
  src: string
  kind: 'image' | 'video'
  alt: string
}

type TimelineItem =
  | { kind: 'message'; key: string; sentAt: string | null; message: Message }
  | { kind: 'note'; key: string; sentAt: string; note: InternalNote }

/** Tique simple = enviado, doble gris = entregado, doble azul = visto por el
 * cliente (WhatsApp: SERVER_ACK/DELIVERY_ACK/READ/PLAYED). */
function MessageStatusTicks({ status }: { status: MessageStatus }) {
  if (status === 'READ' || status === 'PLAYED') {
    return <CheckCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
  }
  if (status === 'DELIVERY_ACK') {
    return <CheckCheck className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
  }
  return <Check className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
}

export function ChatThread({ chat, onRefreshSuggestions }: Props) {
  const {
    data: messagePages,
    isLoading,
    error,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(chat.chat_id)
  // Las páginas llegan desde la más reciente hacia atrás. Se invierte el
  // orden de páginas, pero se conserva el orden ascendente dentro de cada
  // página, para renderizar el historial de viejo a nuevo.
  const messages = [...(messagePages?.pages ?? [])].reverse().flatMap((page) => page.items)
  const { data: notes = [] } = useInternalNotes(chat.chat_id)
  const { data: me } = useMe()
  const { data: customerWindow, isLoading: isLoadingCustomerWindow } = useCustomerServiceWindow(chat.chat_id)
  const isCustomerWindowOpen = useIsCustomerServiceWindowOpen(customerWindow)
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
  ].sort((a, b) => {
    const aTime = a.sentAt ? new Date(a.sentAt).getTime() : Number.MAX_SAFE_INTEGER
    const bTime = b.sentAt ? new Date(b.sentAt).getTime() : Number.MAX_SAFE_INTEGER
    return aTime - bTime || a.key.localeCompare(b.key)
  }), [messages, notes])
  // Algunos mensajes (ej. audios recién enviados) todavía no tienen sent_at
  // confirmado. Si se comparara solo contra el vecino inmediato, un mensaje
  // sin fecha "cortaría" el grupo del día y el siguiente mensaje dispararía
  // un separador de fecha espurio aunque siga siendo el mismo día; por eso
  // se compara contra el último día CON fecha confirmada, no contra el
  // mensaje anterior a secas.
  const dateSeparators = useMemo(() => {
    const separators = new Map<string, boolean>()
    let lastDay: string | null = null
    for (const item of timeline) {
      if (!item.sentAt) continue
      const day = new Date(item.sentAt).toDateString()
      separators.set(item.key, day !== lastDay)
      lastDay = day
    }
    return separators
  }, [timeline])
  const pageCount = messagePages?.pages.length ?? 0
  const lastTimelineKey = timeline.at(-1)?.key ?? null
  const threadRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialScrollDoneRef = useRef(false)
  const isNearBottomRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const latestTimelineKeyRef = useRef<string | null>(null)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const [openMedia, setOpenMedia] = useState<OpenMedia | null>(null)
  const [templateContentToSave, setTemplateContentToSave] = useState<string | null>(null)
  const [multimediaTemplate, setMultimediaTemplate] = useState<MessageTemplate | null>(null)
  const [isNoteMode, setIsNoteMode] = useState(false)

  const [draft, setDraft] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [pendingLocation, setPendingLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [failedMediaIds, setFailedMediaIds] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { mutate: sendMessage, isPending: isSending, error: sendError } = useSendMessage(chat.chat_id)
  const { mutate: sendAudio, isPending: isSendingAudio } = useSendAudio(chat.chat_id)
  const { mutate: sendMedia, isPending: isSendingMedia } = useSendMedia(chat.chat_id)
  const { mutate: sendLocation, isPending: isSendingLocation } = useSendLocation(chat.chat_id)
  const { data: templates = [] } = useTemplates()
  const recordTemplateUse = useRecordTemplateUse()
  const sentMessageHistory = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const message of [...messages].reverse()) {
      if (message.sender !== 'vendedor') continue
      const parsed = parseContent(message.content)
      if (parsed.kind !== 'text' || !parsed.text.trim() || seen.has(parsed.text.trim())) continue
      seen.add(parsed.text.trim()); result.push(parsed.text.trim())
      if (result.length === 10) break
    }
    return result
  }, [messages])

  // Mientras el draft es exactamente "/" + texto sin espacios, se interpreta
  // como un atajo de plantilla en progreso (como en Slack/WhatsApp Business).
  // Un espacio o texto adicional lo convierte en mensaje normal.
  const slashQuery = useMemo(() => {
    if (slashDismissed) return null
    const match = /^\/(\S*)$/.exec(draft)
    return match ? match[1] : null
  }, [draft, slashDismissed])

  const slashSuggestions = useMemo(() => {
    if (slashQuery === null) return []
    const query = slashQuery.toLowerCase()
    return templates
      .filter((t) => t.template_type === 'internal' && t.shortcut?.toLowerCase().startsWith(query))
      .sort((a, b) => Number(b.stage === chat.stage) - Number(a.stage === chat.stage))
      .slice(0, 6)
  }, [templates, slashQuery, chat.stage])

  const activeSlashIndex = Math.min(slashIndex, Math.max(slashSuggestions.length - 1, 0))

  function selectSlashTemplate(template: (typeof slashSuggestions)[number]) {
    if (template.interactive_type !== 'none' || template.attachments.length) setMultimediaTemplate(template)
    else { setDraft(renderTemplate(template, chat)); recordTemplateUse.mutate(template.id) }
    setSlashIndex(0)
    setSlashDismissed(true)
    textareaRef.current?.focus()
  }

  // Cada chat empieza mostrando sus mensajes más recientes.
  useEffect(() => {
    initialScrollDoneRef.current = false
    isNearBottomRef.current = true
    loadingOlderRef.current = false
    latestTimelineKeyRef.current = null
    prependSnapshotRef.current = null
  }, [chat.chat_id])

  useEffect(() => {
    const container = threadRef.current
    if (!container || isLoading) return

    if (!initialScrollDoneRef.current) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
        initialScrollDoneRef.current = true
        isNearBottomRef.current = true
        latestTimelineKeyRef.current = lastTimelineKey
      })
      return
    }

    const snapshot = prependSnapshotRef.current
    if (snapshot) {
      prependSnapshotRef.current = null
      requestAnimationFrame(() => {
        // Compensa exactamente la altura agregada arriba; el mensaje que el
        // usuario estaba leyendo queda en el mismo lugar de la pantalla.
        container.scrollTop = snapshot.scrollTop + (container.scrollHeight - snapshot.scrollHeight)
      })
      return
    }

    if (lastTimelineKey !== latestTimelineKeyRef.current) {
      latestTimelineKeyRef.current = lastTimelineKey
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
      }
    }
  }, [chat.chat_id, isLoading, lastTimelineKey, timeline.length, pageCount])

  // El draft y los errores de envío son por chat: al cambiar de lead no debe
  // quedar pegado el texto ni el error del chat anterior.
  useEffect(() => {
    setDraft('')
    setAudioError(null)
    setMediaError(null)
    setLocationError(null)
    setPendingLocation(null)
    setSlashIndex(0)
    setSlashDismissed(false)
    setIsNoteMode(false)
  }, [chat.chat_id])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || isSending || !isCustomerWindowOpen) return
    sendMessage(text, { onSuccess: () => setDraft('') })
  }

  async function handleAudioRecorded(blob: Blob) {
    if (!isCustomerWindowOpen) {
      setAudioError('La ventana de 24 horas está cerrada')
      return
    }
    setAudioError(null)
    const dataBase64 = await blobToBase64(blob)
    sendAudio(
      { contentType: blob.type || 'audio/webm', dataBase64 },
      { onError: (err) => setAudioError(extractErrorMessage(err)) }
    )
  }

  function openFilePicker(accept: string) {
    if (!isCustomerWindowOpen) return
    const input = fileInputRef.current
    if (!input) return
    input.accept = accept
    input.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo después
    if (!file) return

    // El backend valida el tipo real permitido; acá solo evitamos un
    // roundtrip para el caso obvio de un archivo sin tipo reconocible.
    if (!file.type) {
      setMediaError('No se pudo determinar el tipo de archivo')
      return
    }

    setMediaError(null)
    const dataBase64 = await blobToBase64(file)
    sendMedia(
      { contentType: file.type, dataBase64, filename: file.name },
      { onError: (err) => setMediaError(extractErrorMessage(err)) }
    )
  }

  function handleSendLocation() {
    setLocationError(null)
    if (!isCustomerWindowOpen) {
      setLocationError('La ventana de 24 horas está cerrada')
      return
    }
    if (!navigator.geolocation) {
      setLocationError('Tu navegador no soporta geolocalización')
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false)
        // Igual que WhatsApp: primero mostramos dónde nos ubicó el GPS y
        // pedimos confirmación, en vez de mandarla directo.
        setPendingLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude })
      },
      (err) => {
        setIsLocating(false)
        setLocationError(describeGeolocationError(err))
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  }

  function handleConfirmLocation() {
    if (!pendingLocation) return
    sendLocation(pendingLocation, {
      onSuccess: () => setPendingLocation(null),
      onError: (err) => {
        setLocationError(extractErrorMessage(err))
        setPendingLocation(null)
      },
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % slashSuggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault()
        selectSlashTemplate(slashSuggestions[activeSlashIndex])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e)
    }
  }

  function handleRefresh() {
    refetch()
    onRefreshSuggestions()
  }

  function handleThreadScroll() {
    const container = threadRef.current
    if (!container) return

    isNearBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120

    if (
      container.scrollTop > 80 ||
      !hasNextPage ||
      isFetchingNextPage ||
      loadingOlderRef.current
    ) {
      return
    }

    loadingOlderRef.current = true
    prependSnapshotRef.current = {
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    }
    void fetchNextPage()
      .then((result) => {
        if (result.isError) prependSnapshotRef.current = null
      })
      .finally(() => {
        loadingOlderRef.current = false
      })
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-gray-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {avatarInitial(chat)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{displayName(chat)}</p>
            <CustomerServiceWindowBadge data={customerWindow} isLoading={isLoadingCustomerWindow} />
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefetching}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-500 font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          {isRefetching ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* Thread */}
      <div
        ref={threadRef}
        onScroll={handleThreadScroll}
        className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
      >
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Cargando mensajes...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">Error al cargar mensajes.</p>
        )}
        {!isLoading && !error && timeline.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin mensajes en este chat.</p>
        )}
        {!isLoading && !error && hasNextPage && (
          <button
            onClick={() => {
              const container = threadRef.current
              if (!container || isFetchingNextPage || loadingOlderRef.current) return
              loadingOlderRef.current = true
              prependSnapshotRef.current = {
                scrollHeight: container.scrollHeight,
                scrollTop: container.scrollTop,
              }
              void fetchNextPage()
                .then((result) => {
                  if (result.isError) prependSnapshotRef.current = null
                })
                .finally(() => {
                  loadingOlderRef.current = false
                })
            }}
            disabled={isFetchingNextPage}
            className="mx-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm hover:bg-gray-50 disabled:cursor-wait dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isFetchingNextPage ? 'Cargando anteriores...' : 'Cargar mensajes anteriores'}
          </button>
        )}
        {timeline.map((item) => {
          const showDateSeparator = dateSeparators.get(item.key) ?? false
          if (item.kind === 'note') {
            return (
              <Fragment key={item.key}>
                {showDateSeparator && (
                  <div className="flex justify-center py-1">
                    <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                      {formatDayLabel(item.sentAt)}
                    </span>
                  </div>
                )}
                <InternalNoteCard
                  chatId={chat.chat_id}
                  note={item.note}
                  canManage={me?.role === 'admin' || me?.id === item.note.author_user_id}
                />
              </Fragment>
            )
          }
          const m = item.message
          const isVendedor = m.sender === 'vendedor'
          const { kind, icon: Icon, label, text } = parseContent(m.content)
          // Si el archivo falló al cargar (ej. no existe en este entorno),
          // lo tratamos como si no hubiera media: el navegador muestra su
          // propio ícono roto + el alt completo pegado, duplicando el texto
          // con nuestro caption de abajo.
          const mediaSrc = failedMediaIds.has(m.id) ? null : resolveMediaUrl(m.media_url)
          const markMediaFailed = () => setFailedMediaIds((prev) => new Set(prev).add(m.id))
          return (
            <Fragment key={item.key}>
              {showDateSeparator && (
                <div className="flex justify-center py-1">
                  <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                    {formatDayLabel(m.sent_at as string)}
                  </span>
                </div>
              )}
              <div className={`flex ${isVendedor ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm border ${
                  isVendedor
                    ? 'bg-green-100 dark:bg-green-950/50 border-green-200 dark:border-green-900 text-gray-800 dark:text-gray-100 rounded-tr-sm'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 rounded-tl-sm'
                }`}
              >
                {!mediaSrc && kind !== 'text' && kind !== 'location' && Icon && (
                  <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/10 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </div>
                )}
                {mediaSrc && kind === 'image' && (
                  <img
                    src={mediaSrc}
                    alt={text || 'Imagen'}
                    onClick={() => setOpenMedia({ src: mediaSrc, kind: 'image', alt: text || 'Imagen' })}
                    onError={markMediaFailed}
                    className="rounded-lg max-w-full max-h-80 object-contain mb-1.5 cursor-zoom-in"
                  />
                )}
                {mediaSrc && kind === 'video' && (
                  <div className="relative mb-1.5 inline-block">
                    <video controls src={mediaSrc} onError={markMediaFailed} className="rounded-lg max-w-full max-h-80" />
                    <button
                      onClick={() => setOpenMedia({ src: mediaSrc, kind: 'video', alt: text || 'Video' })}
                      aria-label="Agrandar video"
                      className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {mediaSrc && kind === 'audio' && (
                  <audio controls src={mediaSrc} onError={markMediaFailed} className="max-w-full mb-1.5" />
                )}
                {mediaSrc && kind === 'other' && (
                  <a
                    href={mediaSrc}
                    {...(isPdfFilename(text || '')
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : { download: text || true })}
                    className="flex items-center gap-3 bg-black/5 dark:bg-white/10 rounded-lg px-3 py-2.5 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
                  >
                    <span
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0 ${documentColor(text || '')}`}
                    >
                      <FileText className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-100 truncate not-italic font-medium">
                        {text || 'Documento'}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 not-italic">
                        {documentExtension(text || '')}
                      </p>
                    </div>
                  </a>
                )}
                {kind === 'location' && (() => {
                  const [lat, lon] = text.split(',').map(Number)
                  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon)
                  if (!hasCoords) return null
                  return (
                    <a
                      href={`https://www.google.com/maps?q=${lat},${lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-56 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
                    >
                      <MapPreview latitude={lat} longitude={lon} className="rounded-lg" />
                    </a>
                  )
                })()}
                {kind !== 'other' && kind !== 'location' && (
                  <p className={`whitespace-pre-wrap ${kind !== 'text' ? 'italic text-gray-600 dark:text-gray-400' : ''}`}>
                    {text ? (
                      parseRichText(text).map((segment, i) => {
                        switch (segment.type) {
                          case 'link':
                            return (
                              <a
                                key={i}
                                href={segment.text}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 break-all not-italic"
                              >
                                {segment.text}
                              </a>
                            )
                          case 'bold':
                            return (
                              <strong key={i} className="font-semibold">
                                {segment.text}
                              </strong>
                            )
                          case 'italic':
                            return (
                              <em key={i} className="italic">
                                {segment.text}
                              </em>
                            )
                          case 'strike':
                            return (
                              <span key={i} className="line-through">
                                {segment.text}
                              </span>
                            )
                          case 'code':
                            return (
                              <code
                                key={i}
                                className="font-mono text-[0.85em] bg-black/10 dark:bg-white/15 rounded px-1 py-0.5 not-italic"
                              >
                                {segment.text}
                              </code>
                            )
                          default:
                            return <span key={i}>{segment.text}</span>
                        }
                      })
                    ) : (
                      <span className="italic text-gray-400 dark:text-gray-500">Sin contenido</span>
                    )}
                  </p>
                )}
                <div className="flex items-center justify-end gap-1 text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                  {isVendedor && kind === 'text' && text.trim() && (
                    <button
                      type="button"
                      title="Guardar como plantilla personal"
                      onClick={() => setTemplateContentToSave(text.trim())}
                      className="mr-1 rounded p-0.5 opacity-50 transition-opacity hover:text-green-600 hover:opacity-100"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                    </button>
                  )}
                  <span>{formatMessageTime(m.sent_at)}</span>
                  {isVendedor && <MessageStatusTicks status={m.status} />}
                </div>
              </div>
            </div>
            </Fragment>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      {!isNoteMode && <CustomerServiceWindowNotice data={customerWindow} />}
      {isNoteMode ? (
        <InternalNoteComposer
          chatId={chat.chat_id}
          onCancel={() => setIsNoteMode(false)}
          onCreated={() => setIsNoteMode(false)}
        />
      ) : (
        <form
          onSubmit={handleSend}
          className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3"
        >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-green-700 dark:text-green-400">Mensaje de WhatsApp</span>
          <button
            type="button"
            onClick={() => setIsNoteMode(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
          >
            <MessageSquareLock className="h-3.5 w-3.5" /> Cambiar a nota interna
          </button>
        </div>
        {sendError && (
          <p className="text-xs text-red-500 dark:text-red-400 mb-2">{extractErrorMessage(sendError)}</p>
        )}
        {audioError && <p className="text-xs text-red-500 dark:text-red-400 mb-2">{audioError}</p>}
        {mediaError && <p className="text-xs text-red-500 dark:text-red-400 mb-2">{mediaError}</p>}
        {locationError && <p className="text-xs text-red-500 dark:text-red-400 mb-2">{locationError}</p>}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" onChange={handleFileSelected} className="hidden" />

          {!isRecordingAudio && (
            <AttachMenu
              disabled={!isCustomerWindowOpen || isSendingMedia || isLocating || isSendingLocation}
              isSending={isSendingMedia || isLocating || isSendingLocation}
              onSelectDocument={() => openFilePicker(DOCUMENT_ACCEPT)}
              onSelectMedia={() => openFilePicker(MEDIA_ACCEPT)}
              onSelectAudio={() => openFilePicker(AUDIO_ACCEPT)}
              onSelectLocation={handleSendLocation}
            />
          )}

          {!isRecordingAudio && (
            <TemplatePicker
              chat={chat}
              sentMessages={sentMessageHistory}
              onSaveHistory={setTemplateContentToSave}
              onSendMultimedia={setMultimediaTemplate}
              customerWindowOpen={isCustomerWindowOpen}
              onSelect={(text) => setDraft((current) => current ? `${current}${/\s$/.test(current) ? '' : '\n'}${text}` : text)}
            />
          )}

          {!isRecordingAudio && (
            <div className="relative flex-1">
              {slashSuggestions.length > 0 && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[90vw] rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                  {slashSuggestions.map((template, i) => (
                    <button
                      key={template.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSlashTemplate(template)}
                      onMouseEnter={() => setSlashIndex(i)}
                      className={`block w-full rounded-lg px-3 py-2 text-left ${
                        i === activeSlashIndex ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-900 dark:text-white">/{template.shortcut}</p>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{renderTemplate(template, chat)}</p>
                    </button>
                  ))}
                  <p className="border-t border-gray-100 px-3 pt-1.5 text-[10px] text-gray-400 dark:border-gray-700">
                    ↑↓ para navegar · Enter para insertar · Esc para cerrar
                  </p>
                </div>
              )}
              <textarea
                ref={textareaRef}
                disabled={!isCustomerWindowOpen}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setSlashIndex(0)
                  setSlashDismissed(false)
                }}
                onKeyDown={handleKeyDown}
                placeholder={isCustomerWindowOpen ? 'Escribí un mensaje... (/ para usar una plantilla)' : 'Ventana de 24 horas cerrada'}
                rows={1}
                className="w-full resize-none text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 max-h-32"
              />
            </div>
          )}

          {draft.trim() && !isRecordingAudio ? (
            <button
              type="submit"
              disabled={isSending || !isCustomerWindowOpen}
              aria-label="Enviar mensaje"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          ) : (
            <VoiceRecorder
              disabled={!isCustomerWindowOpen || isSendingAudio || isSendingMedia || isLocating || isSendingLocation}
              onRecorded={handleAudioRecorded}
              onError={setAudioError}
              onRecordingChange={setIsRecordingAudio}
            />
          )}
        </div>
        </form>
      )}

      {openMedia && (
        <MediaLightbox
          src={openMedia.src}
          kind={openMedia.kind}
          alt={openMedia.alt}
          onClose={() => setOpenMedia(null)}
        />
      )}

      {pendingLocation && (
        <LocationConfirmDialog
          latitude={pendingLocation.latitude}
          longitude={pendingLocation.longitude}
          isSending={isSendingLocation}
          onConfirm={handleConfirmLocation}
          onCancel={() => setPendingLocation(null)}
        />
      )}

      {templateContentToSave && (
        <SaveAsTemplateDialog content={templateContentToSave} onClose={() => setTemplateContentToSave(null)} />
      )}

      {multimediaTemplate && (
        <TemplateSendDialog chat={chat} template={multimediaTemplate} onClose={() => setMultimediaTemplate(null)} />
      )}
    </div>
  )
}
