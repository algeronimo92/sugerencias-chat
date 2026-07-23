import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, Check, CheckCheck, ChevronDown, FileText, Loader2, Maximize2, MessageSquareLock, RefreshCw, Send } from 'lucide-react'
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
import { useCustomerServiceWindow } from '../hooks/useCustomerServiceWindow'
import { CustomerServiceWindowBadge, CustomerServiceWindowNotice } from './CustomerServiceWindowStatus'

const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
const MEDIA_ACCEPT = 'image/*,video/*'
const AUDIO_ACCEPT = 'audio/*'

const DOCUMENT_COLORS: Record<string, string> = {
  pdf: 'bg-red-500',
  doc: 'bg-blue-500',
  docx: 'bg-blue-500',
  xls: 'bg-wa-primary',
  xlsx: 'bg-wa-primary',
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
  /** Mensaje al que saltar y resaltar al abrir (desde un resultado de
   * búsqueda que matcheó por un mensaje del historial). */
  highlightMessageId?: number | null
}

interface OpenMedia {
  src: string
  kind: 'image' | 'video'
  alt: string
}

type TimelineItem =
  | { kind: 'message'; key: string; sentAt: string | null; message: Message }
  | { kind: 'note'; key: string; sentAt: string; note: InternalNote }

// Duración del resaltado al saltar a un mensaje desde la búsqueda.
const MESSAGE_FLASH_MS = 2000
// Alto máximo visual de una imagen en el hilo (coincide con max-h-80).
const IMAGE_MAX_HEIGHT_PX = 320
// Padding horizontal (px-3.5 x2) de la burbuja (sin bordes, como WhatsApp):
// lo que se descuenta del ancho máximo de la burbuja (75% del hilo) para el
// contenido.
const BUBBLE_CHROME_PX = 28
// Ventana durante la cual las imágenes que van cargando re-anclan el scroll
// al mensaje saltado — o, en una apertura normal, re-pegan la vista al fondo
// (no guardamos dimensiones de toda la media, así que no se puede reservar el
// espacio exacto por adelantado).
const MEDIA_SETTLE_MS = 4000
// Distancia al fondo a partir de la cual se ofrece el botón "ir al último
// mensaje" (mayor que el umbral de auto-scroll para que no parpadee cerca
// del borde).
const SCROLL_TO_BOTTOM_THRESHOLD_PX = 300

/** Tique simple = enviado, doble gris = entregado, doble azul = visto por el
 * cliente (WhatsApp: SERVER_ACK/DELIVERY_ACK/READ/PLAYED). */
function MessageStatusTicks({ status, onRetry }: { status: MessageStatus; onRetry?: () => void }) {
  if (status === 'PENDING') {
    return <span className="inline-flex items-center gap-1 text-wa-faint dark:text-wa-text-dark/60" aria-label="Enviando" title="Enviando"><Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> Enviando</span>
  }
  if (status === 'FAILED') {
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-red-500 hover:text-red-600" aria-label="No se pudo confirmar el envío. Reintentar" title="Reintentar envío">
        <RefreshCw aria-hidden="true" className="h-3 w-3" /> No enviado · Reintentar
      </button>
    )
  }
  if (status === 'READ' || status === 'PLAYED') {
    return <span aria-label="Leído" title="Leído"><CheckCheck aria-hidden="true" className="w-3.5 h-3.5 text-wa-accent shrink-0" /></span>
  }
  if (status === 'DELIVERY_ACK') {
    return <span aria-label="Entregado" title="Entregado"><CheckCheck aria-hidden="true" className="w-3.5 h-3.5 text-wa-faint dark:text-wa-text-dark/60 shrink-0" /></span>
  }
  return <span aria-label="Enviado" title="Enviado"><Check aria-hidden="true" className="w-3.5 h-3.5 text-wa-faint dark:text-wa-text-dark/60 shrink-0" /></span>
}

export function ChatThread({ chat, highlightMessageId = null }: Props) {
  const {
    data: messagePages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages(chat.chat_id, highlightMessageId)
  // Las páginas llegan desde la más reciente hacia atrás. Se invierte el
  // orden de páginas, pero se conserva el orden ascendente dentro de cada
  // página, para renderizar el historial de viejo a nuevo.
  const messages = useMemo(
    () => [...(messagePages?.pages ?? [])].reverse().flatMap((page) => page.items),
    [messagePages],
  )
  const { data: notes = [] } = useInternalNotes(chat.chat_id)
  const { data: me } = useMe()
  const { data: customerWindow, isLoading: isLoadingCustomerWindow } = useCustomerServiceWindow(chat.chat_id)
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
  // Salto al mensaje matcheado por la búsqueda: pendiente hasta que el
  // mensaje esté cargado; el flash se apaga solo y la clase con transición
  // hace que el resaltado se desvanezca.
  const pendingJumpRef = useRef<number | null>(null)
  const jumpAttemptsRef = useRef(0)
  // Ancla activa tras el salto: cada media que carga vuelve a centrar el
  // mensaje hasta que expira o el usuario scrollea a mano.
  const anchorRef = useRef<{ messageId: number; until: number } | null>(null)
  // Fondo "pegajoso" tras abrir el chat: mientras la ventana esté viva, cada
  // crecimiento del contenido (media sin caja reservada, fuentes, re-medición
  // del ancho) vuelve a pegar la vista al último mensaje. Igual que el ancla
  // del salto: expira sola o la suelta el scroll manual.
  const stickToBottomUntilRef = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [hasNewWhileAway, setHasNewWhileAway] = useState(false)
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null)
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
  const { mutate: sendMessage, retryMessage, error: sendError } = useSendMessage(chat.chat_id)
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
    stickToBottomUntilRef.current = 0
    setShowScrollToBottom(false)
    setHasNewWhileAway(false)
  }, [chat.chat_id])

  useEffect(() => {
    pendingJumpRef.current = highlightMessageId
    jumpAttemptsRef.current = 0
    anchorRef.current = null
    setFlashMessageId(null)
  }, [chat.chat_id, highlightMessageId])

  function jumpToMessage(container: HTMLElement, messageId: number): boolean {
    const el = container.querySelector(`[data-message-id="${messageId}"]`)
    if (!el) return false
    pendingJumpRef.current = null
    isNearBottomRef.current = false
    anchorRef.current = { messageId, until: Date.now() + MEDIA_SETTLE_MS }
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center' })
      setFlashMessageId(messageId)
      window.setTimeout(() => setFlashMessageId(null), MESSAGE_FLASH_MS)
    })
    return true
  }

  // Las imágenes/videos no reservan altura antes de cargar, así que cada
  // carga empuja el layout. Este handler (capture: load no burbujea) vuelve
  // a centrar el mensaje saltado mientras el ancla siga viva, o mantiene la
  // vista pegada al fondo en una apertura normal.
  function handleMediaSettled() {
    const container = threadRef.current
    if (!container || !initialScrollDoneRef.current) return
    const anchor = anchorRef.current
    if (anchor && Date.now() < anchor.until) {
      container
        .querySelector(`[data-message-id="${anchor.messageId}"]`)
        ?.scrollIntoView({ block: 'center' })
      return
    }
    if (isNearBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }

  // El scroll manual del usuario suelta el ancla y el fondo pegajoso
  // (wheel/touch no se disparan con scrollIntoView, así que no interfiere
  // con el re-anclado).
  function releaseAnchor() {
    anchorRef.current = null
    stickToBottomUntilRef.current = 0
  }

  // Ancho del hilo, para calcular el tamaño exacto al que va a renderizar
  // cada imagen/video y reservar esa caja antes de que cargue.
  const [threadWidth, setThreadWidth] = useState(0)
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setThreadWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Los eventos load no cubren todos los reflows (la re-medición del ancho
  // del hilo re-escala las cajas de media sin disparar load, y fuentes/audio
  // players también empujan el layout). Observar el alto real del contenido
  // cubre cualquier causa: mientras haya un ancla viva se re-centra el
  // mensaje saltado; mientras el fondo pegajoso siga activo (o el usuario ya
  // esté leyendo el final) se re-pega al último mensaje.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      const container = threadRef.current
      if (!container) return
      const anchor = anchorRef.current
      if (anchor && Date.now() < anchor.until) {
        container
          .querySelector(`[data-message-id="${anchor.messageId}"]`)
          ?.scrollIntoView({ block: 'center' })
        return
      }
      if (pendingJumpRef.current) return
      if (
        Date.now() < stickToBottomUntilRef.current ||
        (initialScrollDoneRef.current && isNearBottomRef.current)
      ) {
        container.scrollTop = container.scrollHeight
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  /** Caja exacta de render de una imagen/video: proporción original escalada
   * al tope de alto (320px) y al ancho útil de la burbuja (75% del hilo menos
   * padding). Reservarla por adelantado evita que el chat se mueva al cargar. */
  function mediaBoxDimensions(m: Message): { width?: number; height?: number; style?: { width: number; height: number } } {
    if (!m.media_width || !m.media_height) return {}
    let width = m.media_width
    let height = m.media_height
    if (height > IMAGE_MAX_HEIGHT_PX) {
      width = Math.round((width * IMAGE_MAX_HEIGHT_PX) / height)
      height = IMAGE_MAX_HEIGHT_PX
    }
    if (threadWidth > 0) {
      const maxContentWidth = Math.floor(threadWidth * 0.75) - BUBBLE_CHROME_PX
      if (maxContentWidth > 0 && width > maxContentWidth) {
        height = Math.round((height * maxContentWidth) / width)
        width = maxContentWidth
      }
    }
    return { width, height, style: { width, height } }
  }

  useEffect(() => {
    const container = threadRef.current
    if (!container || isLoading) return

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      latestTimelineKeyRef.current = lastTimelineKey
      if (pendingJumpRef.current) {
        if (jumpToMessage(container, pendingJumpRef.current)) return
      } else {
        // La ventana arranca acá y no dentro del rAF: cualquier reflow entre
        // este efecto y el primer frame ya tiene que re-pegar al fondo.
        stickToBottomUntilRef.current = Date.now() + MEDIA_SETTLE_MS
      }
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
        isNearBottomRef.current = true
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
      } else {
        // Está leyendo historial: no se lo mueve, pero el botón de bajar
        // avisa que llegó algo nuevo.
        setHasNewWhileAway(true)
      }
    }
  }, [chat.chat_id, isLoading, lastTimelineKey, timeline.length, pageCount])

  // Si el chat ya estaba cacheado sin el mensaje buscado (la primera página
  // agrandada solo aplica con cache vacía), se pagina hacia atrás hasta
  // encontrarlo, con tope para no recorrer historiales enormes.
  useEffect(() => {
    const container = threadRef.current
    const target = pendingJumpRef.current
    if (!container || !target || isLoading || !initialScrollDoneRef.current) return
    if (jumpToMessage(container, target)) return
    if (hasNextPage && !isFetchingNextPage && jumpAttemptsRef.current < 20) {
      jumpAttemptsRef.current += 1
      void fetchNextPage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, pageCount, hasNextPage, isFetchingNextPage, highlightMessageId])

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
    if (!text) return
    setDraft('')
    sendMessage(text)
  }

  function handleRetryMessage(message: Message) {
    if (!message.content?.trim()) return
    retryMessage(message)
  }

  async function handleAudioRecorded(blob: Blob) {
    setAudioError(null)
    const dataBase64 = await blobToBase64(blob)
    sendAudio(
      { contentType: blob.type || 'audio/webm', dataBase64 },
      { onError: (err) => setAudioError(extractErrorMessage(err)) }
    )
  }

  function openFilePicker(accept: string) {
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

  function handleThreadScroll() {
    const container = threadRef.current
    if (!container) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    isNearBottomRef.current = distanceFromBottom < 120
    if (isNearBottomRef.current) setHasNewWhileAway(false)
    // React ignora el set cuando el valor no cambia: esto no re-renderiza en
    // cada tick de scroll.
    setShowScrollToBottom(distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD_PX)

    if (
      container.scrollTop > 80 ||
      !hasNextPage ||
      isFetchingNextPage ||
      loadingOlderRef.current
    ) {
      return
    }

    loadingOlderRef.current = true
    // Al paginar hacia atrás manda la restauración del snapshot, nunca el
    // fondo pegajoso de la apertura.
    stickToBottomUntilRef.current = 0
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

  function scrollToBottom() {
    releaseAnchor()
    isNearBottomRef.current = true
    setHasNewWhileAway(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  return (
    <div className="flex flex-col h-full bg-wa-chat dark:bg-wa-chat-dark">
      {/* Header — gris claro / #202C33, como el header de conversación de WhatsApp */}
      <div className="px-4 py-2.5 border-b border-wa-border dark:border-wa-border-dark bg-wa-head dark:bg-wa-head-dark flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {avatarInitial(chat)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">{displayName(chat)}</p>
            <CustomerServiceWindowBadge data={customerWindow} isLoading={isLoadingCustomerWindow} />
          </div>
        </div>
      </div>

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
        className="h-full overflow-y-auto px-6 py-4"
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
          <button
            onClick={() => {
              const container = threadRef.current
              if (!container || isFetchingNextPage || loadingOlderRef.current) return
              loadingOlderRef.current = true
              stickToBottomUntilRef.current = 0
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
            className="mx-auto my-2 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-wa-muted shadow-sm hover:bg-wa-hover disabled:cursor-wait dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
          >
            {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isFetchingNextPage ? 'Cargando anteriores...' : 'Cargar mensajes anteriores'}
          </button>
        )}
        {timeline.map((item, index) => {
          const showDateSeparator = dateSeparators.get(item.key) ?? false
          if (item.kind === 'note') {
            return (
              <Fragment key={item.key}>
                {showDateSeparator && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-bubble bg-white px-3 py-1 text-[11px] font-medium text-wa-muted shadow-sm dark:bg-wa-head-dark dark:text-wa-muted-dark">
                      {formatDayLabel(item.sentAt)}
                    </span>
                  </div>
                )}
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
          const m = item.message
          const isVendedor = m.sender === 'vendedor'
          // Agrupación estilo WhatsApp: mensajes consecutivos del mismo autor
          // se pegan entre sí y solo el primero lleva la "colita".
          const prevItem = index > 0 ? timeline[index - 1] : null
          const isFirstOfGroup =
            showDateSeparator ||
            !prevItem ||
            prevItem.kind !== 'message' ||
            prevItem.message.sender !== m.sender
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
                <div className="flex justify-center py-2">
                  <span className="rounded-bubble bg-white px-3 py-1 text-[11px] font-medium text-wa-muted shadow-sm dark:bg-wa-head-dark dark:text-wa-muted-dark">
                    {formatDayLabel(m.sent_at as string)}
                  </span>
                </div>
              )}
              <div
                className={`flex ${isVendedor ? 'justify-end' : 'justify-start'} ${isFirstOfGroup ? 'mt-3' : 'mt-[3px]'}`}
                data-message-id={m.id}
              >
              <div
                className={`max-w-[75%] rounded-bubble px-3.5 py-2 text-sm shadow-sm transition-all duration-700 text-wa-text dark:text-wa-text-dark ${
                  isVendedor
                    ? `bg-wa-out dark:bg-wa-out-dark ${isFirstOfGroup ? 'rounded-tr-none bubble-tail-out' : ''}`
                    : `bg-white dark:bg-wa-in-dark ${isFirstOfGroup ? 'rounded-tl-none bubble-tail-in' : ''}`
                } ${flashMessageId === m.id ? 'ring-2 ring-amber-400 dark:ring-amber-500' : 'ring-0 ring-transparent'}`}
              >
                {!mediaSrc && kind !== 'text' && kind !== 'location' && Icon && (
                  <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/10 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-wa-muted dark:text-wa-text-dark/70 uppercase tracking-wide">
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </div>
                )}
                {mediaSrc && kind === 'image' && (
                  <img
                    src={mediaSrc}
                    alt={text || 'Imagen'}
                    {...mediaBoxDimensions(m)}
                    onClick={() => setOpenMedia({ src: mediaSrc, kind: 'image', alt: text || 'Imagen' })}
                    onError={markMediaFailed}
                    className="rounded-lg max-w-full max-h-80 object-contain mb-1.5 cursor-zoom-in"
                  />
                )}
                {mediaSrc && kind === 'video' && (
                  <div className="relative mb-1.5 inline-block">
                    <video controls src={mediaSrc} onError={markMediaFailed} {...mediaBoxDimensions(m)} className="rounded-lg max-w-full max-h-80" />
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
                      <p className="text-sm text-wa-text dark:text-wa-text-dark truncate not-italic font-medium">
                        {text || 'Documento'}
                      </p>
                      <p className="text-[11px] text-wa-muted dark:text-wa-text-dark/60 not-italic">
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
                  <p className={`whitespace-pre-wrap ${kind !== 'text' ? 'italic text-wa-muted dark:text-wa-text-dark/70' : ''}`}>
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
                                className="underline text-sky-600 dark:text-wa-accent hover:text-sky-800 dark:hover:text-sky-300 break-all not-italic"
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
                      <span className="italic text-wa-faint dark:text-wa-text-dark/50">Sin contenido</span>
                    )}
                  </p>
                )}
                <div className="flex items-center justify-end gap-1 text-[10px] text-wa-faint dark:text-wa-text-dark/60 mt-1">
                  {isVendedor && kind === 'text' && text.trim() && (
                    <button
                      type="button"
                      title="Guardar como plantilla personal"
                      onClick={() => setTemplateContentToSave(text.trim())}
                      className="mr-1 rounded p-0.5 opacity-50 transition-opacity hover:text-wa-primary-strong dark:hover:text-wa-primary hover:opacity-100"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                    </button>
                  )}
                  <span>{formatMessageTime(m.sent_at)}</span>
                  {isVendedor && <MessageStatusTicks status={m.status} onRetry={() => handleRetryMessage(m)} />}
                </div>
              </div>
            </div>
            </Fragment>
          )
        })}
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
          className="border-t border-wa-border dark:border-wa-border-dark bg-wa-head dark:bg-wa-head-dark p-3"
        >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-wa-primary-strong dark:text-wa-primary">Mensaje de WhatsApp</span>
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
              disabled={isSendingMedia || isLocating || isSendingLocation}
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
              onSelect={(text) => setDraft((current) => current ? `${current}${/\s$/.test(current) ? '' : '\n'}${text}` : text)}
            />
          )}

          {!isRecordingAudio && (
            <div className="relative flex-1">
              {slashSuggestions.length > 0 && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[90vw] rounded-xl border border-wa-border bg-white p-1 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark">
                  {slashSuggestions.map((template, i) => (
                    <button
                      key={template.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSlashTemplate(template)}
                      onMouseEnter={() => setSlashIndex(i)}
                      className={`block w-full rounded-lg px-3 py-2 text-left ${
                        i === activeSlashIndex ? 'bg-wa-active dark:bg-wa-active-dark' : 'hover:bg-wa-hover dark:hover:bg-wa-hover-dark'
                      }`}
                    >
                      <p className="text-sm font-medium text-wa-text dark:text-wa-text-dark">/{template.shortcut}</p>
                      <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">{renderTemplate(template, chat)}</p>
                    </button>
                  ))}
                  <p className="border-t border-wa-border px-3 pt-1.5 text-[10px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                    ↑↓ para navegar · Enter para insertar · Esc para cerrar
                  </p>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setSlashIndex(0)
                  setSlashDismissed(false)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Escribí un mensaje... (/ para usar una plantilla)"
                rows={1}
                className="w-full resize-none text-sm bg-white dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-lg px-3.5 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-shadow max-h-32"
              />
            </div>
          )}

          {draft.trim() && !isRecordingAudio ? (
            <button
              type="submit"
              aria-label="Enviar mensaje"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-wa-primary text-white hover:bg-wa-primary-strong active:bg-wa-primary-deep transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <VoiceRecorder
              disabled={isSendingAudio || isSendingMedia || isLocating || isSendingLocation}
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
