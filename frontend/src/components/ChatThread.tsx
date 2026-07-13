import { useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, FileText, Loader2, Maximize2, RefreshCw, Send } from 'lucide-react'
import type { Chat, MessageStatus } from '../types'
import { useMessages, useSendAudio, useSendLocation, useSendMedia, useSendMessage } from '../hooks/useMessages'
import { avatarInitial, displayName } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { formatMessageTime, parseContent, parseRichText, resolveMediaUrl } from '../utils/message'
import { AttachMenu } from './AttachMenu'
import { LocationConfirmDialog } from './LocationConfirmDialog'
import { MapPreview } from './MapPreview'
import { MediaLightbox } from './MediaLightbox'
import { VoiceRecorder } from './VoiceRecorder'

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
  const pageCount = messagePages?.pages.length ?? 0
  const lastMessageId = messages.at(-1)?.id ?? null
  const threadRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialScrollDoneRef = useRef(false)
  const isNearBottomRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const latestMessageIdRef = useRef<number | null>(null)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const [openMedia, setOpenMedia] = useState<OpenMedia | null>(null)

  const [draft, setDraft] = useState('')
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

  // Cada chat empieza mostrando sus mensajes más recientes.
  useEffect(() => {
    initialScrollDoneRef.current = false
    isNearBottomRef.current = true
    loadingOlderRef.current = false
    latestMessageIdRef.current = null
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
        latestMessageIdRef.current = lastMessageId
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

    if (lastMessageId !== latestMessageIdRef.current) {
      latestMessageIdRef.current = lastMessageId
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
      }
    }
  }, [chat.chat_id, isLoading, lastMessageId, messages.length, pageCount])

  // El draft y los errores de envío son por chat: al cambiar de lead no debe
  // quedar pegado el texto ni el error del chat anterior.
  useEffect(() => {
    setDraft('')
    setAudioError(null)
    setMediaError(null)
    setLocationError(null)
    setPendingLocation(null)
  }, [chat.chat_id])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || isSending) return
    sendMessage(text, { onSuccess: () => setDraft('') })
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
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{displayName(chat)}</p>
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
        {!isLoading && !error && messages.length === 0 && (
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
        {messages.map((m) => {
          const isVendedor = m.sender === 'vendedor'
          const { kind, icon: Icon, label, text } = parseContent(m.content)
          // Si el archivo falló al cargar (ej. no existe en este entorno),
          // lo tratamos como si no hubiera media: el navegador muestra su
          // propio ícono roto + el alt completo pegado, duplicando el texto
          // con nuestro caption de abajo.
          const mediaSrc = failedMediaIds.has(m.id) ? null : resolveMediaUrl(m.media_url)
          const markMediaFailed = () => setFailedMediaIds((prev) => new Set(prev).add(m.id))
          return (
            <div key={m.id} className={`flex ${isVendedor ? 'justify-end' : 'justify-start'}`}>
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
                  <span>{formatMessageTime(m.sent_at)}</span>
                  {isVendedor && <MessageStatusTicks status={m.status} />}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <form
        onSubmit={handleSend}
        className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3"
      >
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
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribí un mensaje..."
              rows={1}
              className="flex-1 resize-none text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 max-h-32"
            />
          )}

          {draft.trim() && !isRecordingAudio ? (
            <button
              type="submit"
              disabled={isSending}
              aria-label="Enviar mensaje"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
    </div>
  )
}
