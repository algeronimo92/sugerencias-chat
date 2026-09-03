import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageSquareLock, Send, X } from 'lucide-react'
import type { Chat, MessageTemplate } from '../types'
import { useSendAudio, useSendLocation, useSendMedia, useSendSticker, type ReplyTarget } from '../hooks/useMessages'
import { useRecordTemplateUse, useTemplates } from '../hooks/useTemplates'
import { useDismissiblePopover } from '../hooks/useDismissiblePopover'
import { displayName } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { renderTemplate } from '../utils/templates'
import { compressImage } from '../utils/media'
import { AttachMenu } from './AttachMenu'
import { EmojiStickerPanel } from './EmojiStickerPanel'
import { FlowPicker } from './FlowPicker'
import { LocationConfirmDialog } from './LocationConfirmDialog'
import { MediaPreviewDialog } from './MediaPreviewDialog'
import { QuotedMessage } from './QuotedMessage'
import { TemplatePicker } from './TemplatePicker'
import { VoiceRecorder } from './VoiceRecorder'

const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
const MEDIA_ACCEPT = 'image/*,video/*'
const AUDIO_ACCEPT = 'audio/*'
const COMPOSER_MAX_HEIGHT = 128

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
  /** Mensajes ya enviados que se ofrecen para reenviar o guardar como plantilla. */
  sentMessageHistory: string[]
  /** La cita vive en el padre: la inician las burbujas del hilo y la consume
   *  el compositor, así que ninguno de los dos puede ser su dueño exclusivo. */
  replyTo: ReplyTarget | null
  onReplyChange: (replyTo: ReplyTarget | null) => void
  onQuotedJump: (messageId: number) => void
  onSwitchToNote: () => void
  onSaveTemplate: (content: string) => void
  onSendMultimediaTemplate: (template: MessageTemplate) => void
  /** Vienen del padre y no de un useSendMessage propio: el hilo también
   *  necesita retryMessage de esa misma instancia, y su `error` combina los
   *  fallos de envío con los de reintento. Duplicar el hook separaría los dos. */
  sendMessage: (payload: { text: string; replyTo: ReplyTarget | null }) => void
  sendError: Error | null
}

/**
 * La barra de escritura del chat: texto, atajos `/` de plantillas, cita,
 * audio, adjuntos y ubicación.
 */
export function ChatComposer({
  chat,
  sentMessageHistory,
  replyTo,
  onReplyChange,
  onQuotedJump,
  onSwitchToNote,
  onSaveTemplate,
  onSendMultimediaTemplate,
  sendMessage,
  sendError,
}: Props) {
  const [draft, setDraft] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [stickerError, setStickerError] = useState<string | null>(null)
  // Imagen/video/documento elegido o pegado, a la espera de confirmar el envío
  // con epígrafe (la pantalla de preview de WhatsApp). Puede traer varios ítems
  // cuando se eligieron varias fotos/videos juntos: se mandan como mensajes
  // separados (Evolution API no tiene forma de mandar un álbum nativo agrupado
  // del lado del cliente, ver docs/n8n-normalizacion-wsp-messages.md), pero el
  // propio hilo del CRM los agrupa en grilla igual que a los que llegan así.
  interface PendingMediaItem { file: File; previewUrl: string; kind: 'image' | 'video' | 'document' }
  const [pendingMedia, setPendingMedia] = useState<{ items: PendingMediaItem[]; activeIndex: number } | null>(null)
  const [isSendingMedia, setIsSendingMedia] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [pendingLocation, setPendingLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Última posición del cursor en el textarea: la fija el propio textarea (onSelect)
  // y la usa la inserción de emojis. Cuando queda no-null tras insertar, el efecto
  // de abajo restaura el cursor una vez que React comiteó el nuevo draft (el
  // textarea es controlado, así que no se puede mover el caret en el mismo tick).
  const caretRef = useRef<number | null>(null)

  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    const start = el ? el.selectionStart : caretRef.current ?? draft.length
    const end = el ? el.selectionEnd : start
    caretRef.current = start + emoji.length
    setDraft((current) => current.slice(0, start) + emoji + current.slice(end))
  }

  useLayoutEffect(() => {
    if (caretRef.current == null) return
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(caretRef.current, caretRef.current)
    }
    caretRef.current = null
  }, [draft])

  // `rows={1}` conserva el compositor compacto cuando está vacío. A medida
  // que entra texto (también al insertar una plantilla) se adapta al contenido
  // hasta el límite; recién entonces aparece el scroll interno.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return

    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [draft])

  const { mutate: sendAudio } = useSendAudio(chat.chat_id)
  const { mutate: sendMedia } = useSendMedia(chat.chat_id)
  const { mutate: sendLocation } = useSendLocation(chat.chat_id)
  const { mutate: sendSticker } = useSendSticker(chat.chat_id)
  const { data: templates = [] } = useTemplates()
  const recordTemplateUse = useRecordTemplateUse()

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
  const slashPopoverRef = useDismissiblePopover<HTMLDivElement>(
    slashSuggestions.length > 0,
    () => setSlashDismissed(true),
  )

  const activeSlashIndex = Math.min(slashIndex, Math.max(slashSuggestions.length - 1, 0))

  function selectSlashTemplate(template: (typeof slashSuggestions)[number]) {
    if (template.interactive_type !== 'none' || template.attachments.length) onSendMultimediaTemplate(template)
    else { setDraft(renderTemplate(template, chat)); recordTemplateUse.mutate(template.id) }
    setSlashIndex(0)
    setSlashDismissed(true)
    textareaRef.current?.focus()
  }

  // El draft y los errores de envío son por chat: al cambiar de lead no debe
  // quedar pegado el texto ni el error del chat anterior.
  useEffect(() => {
    setDraft('')
    setAudioError(null)
    setMediaError(null)
    setLocationError(null)
    setStickerError(null)
    setPendingLocation(null)
    setSlashIndex(0)
    setSlashDismissed(false)
  }, [chat.chat_id])

  // Responder desde una burbuja tiene que dejar el cursor listo para escribir.
  // La cita es un objeto nuevo en cada click, así que esto se dispara incluso
  // al responder dos veces al mismo mensaje.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onReplyChange(null)
    sendMessage({ text, replyTo })
  }

  async function handleAudioRecorded(blob: Blob) {
    setAudioError(null)
    // La cita se captura antes del await: durante la codificación el usuario
    // puede haber cancelado la respuesta o cambiado a otra.
    const target = replyTo
    onReplyChange(null)
    const dataBase64 = await blobToBase64(blob)
    sendAudio(
      { contentType: blob.type || 'audio/webm', dataBase64, replyTo: target },
      { onError: (err) => setAudioError(extractErrorMessage(err)) }
    )
  }

  function openFilePicker(accept: string, multiple = false) {
    const input = fileInputRef.current
    if (!input) return
    input.accept = accept
    input.multiple = multiple
    input.click()
  }

  function toPendingItem(file: File): PendingMediaItem {
    return {
      file,
      previewUrl: URL.createObjectURL(file),
      kind: file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : 'document',
    }
  }

  function openMediaPreview(file: File) {
    setMediaError(null)
    setPendingMedia({ items: [toPendingItem(file)], activeIndex: 0 })
  }

  /** Varias fotos/videos elegidos juntos: se van a mandar como mensajes
   * separados (ver el comentario de `pendingMedia`), pero en una sola pasada
   * de preview — como el selector múltiple de WhatsApp. */
  function openMediaPreviewMulti(files: File[]) {
    if (!files.length) return
    setMediaError(null)
    setPendingMedia({ items: files.map(toPendingItem), activeIndex: 0 })
  }

  function closeMediaPreview() {
    setPendingMedia((current) => {
      current?.items.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return null
    })
    setIsSendingMedia(false)
  }

  /** Saca un ítem del lote (la X de su miniatura en la tira). Si era el
   * último, cierra la preview entera — igual que cancelar. */
  function removePendingItem(index: number) {
    setPendingMedia((current) => {
      if (!current) return current
      URL.revokeObjectURL(current.items[index].previewUrl)
      const items = current.items.filter((_, i) => i !== index)
      if (!items.length) return null
      return { items, activeIndex: Math.min(current.activeIndex, items.length - 1) }
    })
  }

  function applyCroppedMedia(file: File) {
    setPendingMedia((current) => {
      if (!current) return current
      URL.revokeObjectURL(current.items[current.activeIndex].previewUrl)
      const items = [...current.items]
      items[current.activeIndex] = { file, previewUrl: URL.createObjectURL(file), kind: 'image' }
      return { ...current, items }
    })
  }

  async function sendMediaFile(file: File, caption: string, albumId?: string) {
    const target = replyTo
    onReplyChange(null)
    // Las imágenes grandes se comprimen en el navegador (como WhatsApp) para no
    // chocar con el límite de tamaño. El video no se puede recomprimir acá.
    const toSend = await compressImage(file)
    const dataBase64 = await blobToBase64(toSend)
    sendMedia(
      { contentType: toSend.type, dataBase64, filename: toSend.name, caption, replyTo: target, albumId },
      { onError: (err) => setMediaError(extractErrorMessage(err)) }
    )
  }

  async function confirmPendingMedia(caption: string) {
    if (!pendingMedia) return
    setIsSendingMedia(true)
    const { items } = pendingMedia
    // Con 2+ archivos, todos comparten un id de álbum: como WhatsApp no deja
    // mandar un álbum nativo agrupado del lado del cliente (no lo expone
    // Evolution API), esto es lo que deja agrupar el lote en grilla dentro
    // del propio hilo del CRM sin depender de adivinar por tiempo.
    const albumId = items.length > 1 ? crypto.randomUUID() : undefined
    // El epígrafe va solo en el último de la tanda, como en WhatsApp: ahí es
    // donde se ve al agruparse en el hilo.
    for (let i = 0; i < items.length; i++) {
      await sendMediaFile(items[i].file, i === items.length - 1 ? caption : '', albumId)
    }
    closeMediaPreview()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // permite volver a elegir el mismo archivo después
    if (!files.length) return

    // El backend valida el tipo real permitido; acá solo evitamos un
    // roundtrip para el caso obvio de un archivo sin tipo reconocible.
    if (files.some((file) => !file.type)) {
      setMediaError('No se pudo determinar el tipo de archivo')
      return
    }

    if (files.length > 1) {
      openMediaPreviewMulti(files)
      return
    }

    const file = files[0]
    // Imagen, video y documento: pantalla de preview con epígrafe, como
    // WhatsApp. El audio elegido desde el selector de archivos se manda
    // directo, sin preview visual (a diferencia de la nota de voz grabada,
    // que tiene su propia previsualización en VoiceRecorder).
    if (!file.type.startsWith('audio/')) {
      openMediaPreview(file)
      return
    }

    setMediaError(null)
    await sendMediaFile(file, '')
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const isMedia = (type: string) => type.startsWith('image/') || type.startsWith('video/')
    // Captura de pantalla o archivo copiado (clipboardData.files) e imagen
    // copiada desde una web (clipboardData.items -> getAsFile).
    let file = Array.from(e.clipboardData.files).find((f) => isMedia(f.type)) ?? null
    if (!file) {
      const item = Array.from(e.clipboardData.items).find((i) => i.kind === 'file' && isMedia(i.type))
      file = item?.getAsFile() ?? null
    }
    if (!file) return
    e.preventDefault()
    openMediaPreview(file)
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
    const location = pendingLocation
    setPendingLocation(null)
    onReplyChange(null)
    sendLocation({ ...location, replyTo }, {
      onError: (err) => {
        setLocationError(extractErrorMessage(err))
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
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault()
      onReplyChange(null)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e)
    }
  }

  return (
    <>
      <form
        onSubmit={handleSend}
        className="border-t border-wa-border dark:border-wa-border-dark bg-wa-head dark:bg-wa-head-dark px-3 pt-3 pb-safe-3"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-wa-primary-strong dark:text-wa-primary">Mensaje de WhatsApp</span>
          <button
            type="button"
            onClick={onSwitchToNote}
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
        {stickerError && <p className="text-xs text-red-500 dark:text-red-400 mb-2">{stickerError}</p>}
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-white p-2 dark:bg-wa-field-dark">
            <div className="min-w-0 flex-1">
              <QuotedMessage
                sender={replyTo.sender}
                content={replyTo.content}
                contactName={displayName(chat)}
                onJump={() => onQuotedJump(replyTo.id)}
              />
            </div>
            <button
              type="button"
              onClick={() => onReplyChange(null)}
              aria-label="Cancelar respuesta"
              title="Cancelar respuesta (Esc)"
              className="shrink-0 rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" onChange={handleFileSelected} className="hidden" />

          {!isRecordingAudio && (
            <EmojiStickerPanel
              onInsertEmoji={insertEmoji}
              onSelectSticker={(asset) => {
                setStickerError(null)
                sendSticker(
                  { assetId: asset.id, mediaUrl: asset.media_url },
                  { onError: (err) => setStickerError(extractErrorMessage(err)) },
                )
              }}
            />
          )}

          {!isRecordingAudio && (
            <AttachMenu
              disabled={isLocating}
              isSending={isLocating}
              onSelectDocument={() => openFilePicker(DOCUMENT_ACCEPT)}
              onSelectMedia={() => openFilePicker(MEDIA_ACCEPT, true)}
              onSelectAudio={() => openFilePicker(AUDIO_ACCEPT)}
              onSelectLocation={handleSendLocation}
            />
          )}

          {!isRecordingAudio && (
            <TemplatePicker
              chat={chat}
              sentMessages={sentMessageHistory}
              onSaveHistory={onSaveTemplate}
              onSendMultimedia={onSendMultimediaTemplate}
              onSelect={(text) => setDraft((current) => current ? `${current}${/\s$/.test(current) ? '' : '\n'}${text}` : text)}
            />
          )}

          {!isRecordingAudio && <FlowPicker chatId={chat.chat_id} />}

          {!isRecordingAudio && (
            <div ref={slashPopoverRef} className="relative flex-1">
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
                onPaste={handlePaste}
                placeholder="Escribe un mensaje..."
                rows={1}
                className="w-full max-h-32 resize-none overflow-y-hidden text-sm bg-white dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-lg px-3.5 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-shadow"
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
              disabled={isLocating}
              onRecorded={handleAudioRecorded}
              onError={setAudioError}
              onRecordingChange={setIsRecordingAudio}
            />
          )}
        </div>
      </form>

      {pendingLocation && (
        <LocationConfirmDialog
          latitude={pendingLocation.latitude}
          longitude={pendingLocation.longitude}
          isSending={false}
          onConfirm={handleConfirmLocation}
          onCancel={() => setPendingLocation(null)}
        />
      )}

      {pendingMedia && (
        <MediaPreviewDialog
          previewUrl={pendingMedia.items[pendingMedia.activeIndex].previewUrl}
          kind={pendingMedia.items[pendingMedia.activeIndex].kind}
          filename={pendingMedia.items[pendingMedia.activeIndex].file.name}
          contentType={pendingMedia.items[pendingMedia.activeIndex].file.type}
          fileSize={pendingMedia.items[pendingMedia.activeIndex].file.size}
          thumbnails={pendingMedia.items.length > 1
            ? pendingMedia.items.map((item) => ({ previewUrl: item.previewUrl, kind: item.kind }))
            : undefined}
          activeIndex={pendingMedia.activeIndex}
          onSelectThumbnail={(index) => setPendingMedia((current) => current && { ...current, activeIndex: index })}
          onRemoveThumbnail={removePendingItem}
          isSending={isSendingMedia}
          onSend={confirmPendingMedia}
          onCropped={applyCroppedMedia}
          onClose={closeMediaPreview}
        />
      )}
    </>
  )
}
