import { BookmarkPlus, Check, CheckCheck, CornerUpLeft, Loader2, RefreshCw } from 'lucide-react'
import type { Chat, Message, MessageStatus } from '../types'
import { displayName } from '../utils/chat'
import { formatMessageTime, parseContent, resolveMediaUrl } from '../utils/message'
import { MessageAnalysis, MessageBody } from './messageBody'
import { QuotedMessage } from './QuotedMessage'
import { ReactionBadge, ReactionMenu } from './MessageReactions'
import { TemplateMessageButtons } from './TemplateMessageCard'

// Alto máximo visual de una imagen en el hilo (coincide con max-h-80).
const IMAGE_MAX_HEIGHT_PX = 320
// Padding horizontal (px-3.5 x2) de la burbuja (sin bordes, como WhatsApp):
// lo que se descuenta del ancho máximo de la burbuja (75% del hilo) para el
// contenido.
const BUBBLE_CHROME_PX = 28

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
  onReact: (emoji: string) => void
  onSaveTemplate: (content: string) => void
}

/** Una burbuja del hilo: texto, media, ubicación, documento o plantilla, con
 *  su cita, su hora y sus tiques de entrega. El cuerpo lo elige el registro
 *  de renderers por tipo (messageBody). */
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
  onReact,
  onSaveTemplate,
}: Props) {
  const isVendedor = m.sender === 'vendedor'
  const parsed = parseContent(m)
  const { kind, text, analysis, template } = parsed
  const reactions = m.reactions ?? []
  // Si el archivo falló al cargar (ej. no existe en este entorno),
  // lo tratamos como si no hubiera media: el navegador muestra su
  // propio ícono roto + el alt completo pegado, duplicando el texto
  // con nuestro caption de abajo.
  const mediaSrc = hasFailedMedia ? null : resolveMediaUrl(m.media_url)
  const isVisualMedia = mediaSrc != null && (kind === 'image' || kind === 'video' || kind === 'sticker')

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
  const messageActions = canReply && (
    <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button
        type="button"
        onClick={onStartReply}
        aria-label="Responder a este mensaje"
        title="Responder"
        className="rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
      >
        <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <ReactionMenu
        ownEmoji={reactions.find((r) => r.from_me)?.emoji ?? null}
        onReact={onReact}
        side={isVendedor ? 'left' : 'right'}
      />
    </div>
  )

  return (
    <div
      className={`group flex items-center gap-1 ${isVendedor ? 'justify-end' : 'justify-start'} ${isFirstOfGroup ? 'mt-3' : 'mt-[3px]'} ${reactions.length > 0 ? 'mb-2.5' : ''}`}
      data-message-id={m.id}
    >
      {isVendedor && messageActions}
      {/* Columna: la burbuja y, debajo, los botones de la plantilla.
          Al estirarse los dos al ancho de la columna, los botones
          quedan tan anchos como la burbuja (y al revés), igual que
          en WhatsApp.
          85% en móvil, como WhatsApp: al 75% de una pantalla de
          360px los mensajes se parten en demasiadas líneas. */}
      <div className="flex max-w-[85%] flex-col sm:max-w-[75%]">
        <div
          className={`relative rounded-bubble text-sm shadow-sm transition-all duration-700 text-wa-text dark:text-wa-text-dark ${isVisualMedia ? 'p-1.5' : 'px-3.5 py-2'} ${
            isVendedor
              ? `bg-wa-out dark:bg-wa-out-dark ${isFirstOfGroup ? 'rounded-tr-none bubble-tail-out' : ''}`
              : `bg-white dark:bg-wa-in-dark ${isFirstOfGroup ? 'rounded-tl-none bubble-tail-in' : ''}`
          } ${isFlashing ? 'ring-2 ring-amber-400 dark:ring-amber-500' : 'ring-0 ring-transparent'}`}
        >
          {m.quoted_message_id != null && (
            <QuotedMessage
              sender={m.quoted_sender ?? 'cliente'}
              content={m.quoted_content ?? null}
              messageType={m.quoted_message_type}
              contactName={displayName(chat)}
              onJump={() => onQuotedJump(m.quoted_message_id as number)}
              className="mb-1"
            />
          )}
          <MessageBody
            message={m}
            parsed={parsed}
            mediaSrc={mediaSrc}
            isVendedor={isVendedor}
            mediaBox={mediaBoxDimensions()}
            onMediaError={onMediaFailed}
            onOpenMedia={onOpenMedia}
            videoFooter={<><span>{formatMessageTime(m.sent_at)}</span>{isVendedor && <MessageStatusTicks status={m.status} onRetry={onRetry} />}</>}
            hasQuote={m.quoted_message_id != null}
          />
          {analysis && <MessageAnalysis summary={analysis} />}
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
          <ReactionBadge reactions={reactions} isVendedor={isVendedor} />
        </div>
        {(kind === 'template' || kind === 'interactive') && template && (
          <TemplateMessageButtons template={template} isVendedor={isVendedor} />
        )}
      </div>
      {!isVendedor && messageActions}
    </div>
  )
}
