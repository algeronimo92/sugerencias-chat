import { BookmarkPlus, Check, CheckCheck, CornerUpLeft, FileText, Loader2, RefreshCw } from 'lucide-react'
import type { Chat, Message, MessageStatus } from '../types'
import { displayName } from '../utils/chat'
import { formatMessageTime, parseContent, resolveMediaUrl } from '../utils/message'
import { MapPreview } from './MapPreview'
import { AudioPlayer } from './MediaPlayer'
import { ChatVideoMessage } from './ChatVideoMessage'
import { QuotedMessage } from './QuotedMessage'
import { RichText } from './RichText'
import { TemplateMessageButtons, TemplateMessagePreview } from './TemplateMessageCard'

// Alto máximo visual de una imagen en el hilo (coincide con max-h-80).
const IMAGE_MAX_HEIGHT_PX = 320
// Padding horizontal (px-3.5 x2) de la burbuja (sin bordes, como WhatsApp):
// lo que se descuenta del ancho máximo de la burbuja (75% del hilo) para el
// contenido.
const BUBBLE_CHROME_PX = 28

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

export interface OpenMedia {
  src: string
  kind: 'image' | 'video'
  alt: string
}

/** Tique simple = enviado, doble gris = entregado, doble azul = visto por el
 * cliente. En audios, PLAYED agrega además una confirmación visible de que
 * el destinatario reprodujo la nota de voz. */
export function MessageStatusTicks({ status, isAudio = false, onRetry }: { status: MessageStatus; isAudio?: boolean; onRetry?: () => void }) {
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
  if (status === 'PLAYED') {
    const label = isAudio ? 'Audio escuchado' : 'Leído'
    return <span aria-label={label} title={label}><CheckCheck aria-hidden="true" className="w-3.5 h-3.5 text-wa-accent shrink-0" /></span>
  }
  if (status === 'READ') {
    return <span aria-label="Leído" title="Leído"><CheckCheck aria-hidden="true" className="w-3.5 h-3.5 text-wa-accent shrink-0" /></span>
  }
  if (status === 'DELIVERY_ACK') {
    return <span aria-label="Entregado" title="Entregado"><CheckCheck aria-hidden="true" className="w-3.5 h-3.5 text-wa-faint dark:text-wa-text-dark/60 shrink-0" /></span>
  }
  return <span aria-label="Enviado" title="Enviado"><Check aria-hidden="true" className="w-3.5 h-3.5 text-wa-faint dark:text-wa-text-dark/60 shrink-0" /></span>
}

interface Props {
  chat: Chat
  message: Message
  /** Primero de una tanda del mismo autor: lleva la "colita" y más margen. */
  isFirstOfGroup: boolean
  /** Resaltado temporal tras saltar a este mensaje desde una búsqueda o cita. */
  isFlashing: boolean
  /** Ancho del hilo, para reservar la caja exacta de imágenes y videos. */
  threadWidth: number
  /** El archivo no cargó: se pinta como si el mensaje no tuviera media. */
  hasFailedMedia: boolean
  onMediaFailed: () => void
  onOpenMedia: (media: OpenMedia) => void
  onQuotedJump: (messageId: number) => void
  onRetry: () => void
  onStartReply: () => void
  onSaveTemplate: (content: string) => void
}

/** Una burbuja del hilo: texto, media, ubicación, documento o plantilla, con
 *  su cita, su hora y sus tiques de entrega. */
export function MessageBubble({
  chat,
  message: m,
  isFirstOfGroup,
  isFlashing,
  threadWidth,
  hasFailedMedia,
  onMediaFailed,
  onOpenMedia,
  onQuotedJump,
  onRetry,
  onStartReply,
  onSaveTemplate,
}: Props) {
  const isVendedor = m.sender === 'vendedor'
  const { kind, icon: Icon, label, text, template } = parseContent(m.content)
  // Si el archivo falló al cargar (ej. no existe en este entorno),
  // lo tratamos como si no hubiera media: el navegador muestra su
  // propio ícono roto + el alt completo pegado, duplicando el texto
  // con nuestro caption de abajo.
  const mediaSrc = hasFailedMedia ? null : resolveMediaUrl(m.media_url)
  const isVisualMedia = mediaSrc != null && (kind === 'image' || kind === 'video')

  /** Caja exacta de render de una imagen/video: proporción original escalada
   * al tope de alto (320px) y al ancho útil de la burbuja (75% del hilo menos
   * padding). Reservarla por adelantado evita que el chat se mueva al cargar. */
  function mediaBoxDimensions(): { width?: number; height?: number; style?: { width: number; height: number } } {
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

  /** Aparece al pasar el mouse por la burbuja, del lado de afuera, para no
   * tapar el contenido. Queda visible al enfocarlo con el teclado.
   *
   * Solo se puede citar un mensaje que ya existe en WhatsApp: sin
   * wa_message_id (envío en curso, fallido, o histórico previo a la
   * integración) el botón no aparece en vez de fallar al enviar. */
  const canReply = m.id > 0 && !!m.wa_message_id
  const replyButton = (
    <button
      type="button"
      onClick={onStartReply}
      aria-label="Responder a este mensaje"
      title="Responder"
      className="shrink-0 rounded-full p-1.5 text-wa-muted opacity-0 transition-opacity hover:bg-black/5 hover:text-wa-text focus-visible:opacity-100 group-hover:opacity-100 dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
    >
      <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div
      className={`group flex items-center gap-1 ${isVendedor ? 'justify-end' : 'justify-start'} ${isFirstOfGroup ? 'mt-3' : 'mt-[3px]'}`}
      data-message-id={m.id}
    >
      {isVendedor && canReply && replyButton}
      {/* Columna: la burbuja y, debajo, los botones de la plantilla.
          Al estirarse los dos al ancho de la columna, los botones
          quedan tan anchos como la burbuja (y al revés), igual que
          en WhatsApp.
          85% en móvil, como WhatsApp: al 75% de una pantalla de
          360px los mensajes se parten en demasiadas líneas. */}
      <div className="flex max-w-[85%] flex-col sm:max-w-[75%]">
        <div
          className={`rounded-bubble text-sm shadow-sm transition-all duration-700 text-wa-text dark:text-wa-text-dark ${isVisualMedia ? 'p-1.5' : 'px-3.5 py-2'} ${
            isVendedor
              ? `bg-wa-out dark:bg-wa-out-dark ${isFirstOfGroup ? 'rounded-tr-none bubble-tail-out' : ''}`
              : `bg-white dark:bg-wa-in-dark ${isFirstOfGroup ? 'rounded-tl-none bubble-tail-in' : ''}`
          } ${isFlashing ? 'ring-2 ring-amber-400 dark:ring-amber-500' : 'ring-0 ring-transparent'}`}
        >
          {m.quoted_message_id != null && (
            <QuotedMessage
              sender={m.quoted_sender ?? 'cliente'}
              content={m.quoted_content ?? null}
              contactName={displayName(chat)}
              onJump={() => onQuotedJump(m.quoted_message_id as number)}
              className="mb-1"
            />
          )}
          {kind === 'template' && template && (
            <TemplateMessagePreview template={template} hasQuote={m.quoted_message_id != null} />
          )}
          {/* En el hilo la plantilla se pinta entera (preview + botones),
              así que el chip de tipo solo estorba; en la lista de chats
              y en las citas sí se usa para resumirla. */}
          {!mediaSrc && kind !== 'text' && kind !== 'location' && kind !== 'template' && Icon && (
            <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/10 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-wa-muted dark:text-wa-text-dark/70 uppercase tracking-wide">
              <Icon className="w-3 h-3" />
              <span>{label}</span>
            </div>
          )}
          {mediaSrc && kind === 'image' && (
            <img
              src={mediaSrc}
              alt={text || 'Imagen'}
              {...mediaBoxDimensions()}
              onClick={() => onOpenMedia({ src: mediaSrc, kind: 'image', alt: text || 'Imagen' })}
              onError={onMediaFailed}
              className="rounded-lg max-w-full max-h-80 object-contain mb-1.5 cursor-zoom-in"
            />
          )}
          {mediaSrc && kind === 'video' && (
            (() => {
              const { style } = mediaBoxDimensions()
              return (
                <ChatVideoMessage
                  src={mediaSrc}
                  alt={text || 'Video'}
                  onError={onMediaFailed}
                  style={style}
                  className={`max-w-full ${style ? '' : 'h-56 w-[min(100%,360px)]'}`}
                  onOpenGallery={() => onOpenMedia({ src: mediaSrc, kind: 'video', alt: text || 'Video' })}
                  footer={<><span>{formatMessageTime(m.sent_at)}</span>{isVendedor && <MessageStatusTicks status={m.status} onRetry={onRetry} />}</>}
                />
              )
            })()
          )}
          {mediaSrc && kind === 'audio' && (
            <AudioPlayer src={mediaSrc} onError={onMediaFailed} variant="bubble" className="mb-1.5 min-w-[min(16rem,100%)] max-w-full" />
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
            // El cuerpo de una plantilla es texto real del anuncio, no
            // un marcador de adjunto: se pinta como un mensaje normal.
            <p className={`whitespace-pre-wrap ${kind === 'text' || template ? '' : 'italic text-wa-muted dark:text-wa-text-dark/70'}`}>
              {text ? <RichText text={text} /> : ""}
            </p>
          )}
          {kind === 'template' && template?.footer && (
            <p className="mt-0.5 text-[11px] text-wa-muted dark:text-wa-text-dark/60">{template.footer}</p>
          )}
          {kind !== 'video' && <div className="flex items-center justify-end gap-1 text-[10px] text-wa-faint dark:text-wa-text-dark/60 mt-1">
            {isVendedor && kind === 'text' && text.trim() && (
              <button
                type="button"
                title="Guardar como plantilla personal"
                onClick={() => onSaveTemplate(text.trim())}
                className="mr-1 rounded p-0.5 opacity-50 transition-opacity hover:text-wa-primary-strong dark:hover:text-wa-primary hover:opacity-100"
              >
                <BookmarkPlus className="h-3 w-3" />
              </button>
            )}
            {isVendedor && kind === 'audio' && m.status !== 'PENDING' && m.status !== 'FAILED' && (
              <span
                className={`mr-0.5 inline-flex items-center gap-1 font-medium ${
                  m.status === 'PLAYED'
                    ? 'text-wa-accent'
                    : 'text-wa-muted dark:text-wa-text-dark/60'
                }`}
                title={m.status === 'PLAYED'
                  ? 'WhatsApp confirmó que el cliente reprodujo este audio'
                  : 'WhatsApp todavía no confirmó la reproducción de este audio'}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${m.status === 'PLAYED' ? 'bg-wa-accent' : 'bg-current opacity-60'}`}
                />
                {m.status === 'PLAYED' ? 'Escuchado' : 'No escuchado'}
              </span>
            )}
            <span>{formatMessageTime(m.sent_at)}</span>
            {isVendedor && <MessageStatusTicks status={m.status} isAudio={kind === 'audio'} onRetry={onRetry} />}
          </div>}
        </div>
        {kind === 'template' && template && (
          <TemplateMessageButtons template={template} isVendedor={isVendedor} />
        )}
      </div>
      {!isVendedor && canReply && replyButton}
    </div>
  )
}
