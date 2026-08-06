import { Ban, BookmarkPlus, Check, CheckCheck, CornerUpLeft, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { Chat, Message, MessageStatus } from '../types'
import { displayName } from '../utils/chat'
import { formatMessageTime, messageAdReferral, parseContent, resolveMediaUrl } from '../utils/message'
import { AdReferralCard } from './AdReferralCard'
import { MessageAnalysis, MessageBody } from './messageBody'
import { QuotedMessage } from './QuotedMessage'
import { ReactionBadge, ReactionMenu } from './MessageReactions'
import { TemplateMessageButtons } from './TemplateMessageCard'
import { ConfirmDialog } from './ui/ConfirmDialog'

// Alto máximo visual de una imagen en el hilo (coincide con max-h-80).
const IMAGE_MAX_HEIGHT_PX = 320
// WhatsApp solo deja reescribir un mensaje propio de texto dentro de este
// margen. Se replica acá para no ofrecer un botón que el backend va a
// rechazar; el límite real lo sigue poniendo WhatsApp.
const EDIT_WINDOW_MS = 15 * 60 * 1000
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
  onPreviewSticker: (item: { src: string; mediaUrl: string }) => void
  onQuotedJump: (messageId: number) => void
  onRetry: () => void
  onStartReply: () => void
  onReact: (emoji: string) => void
  onEdit: () => void
  onDelete: () => void
  /** El borrado en WhatsApp está en curso: el botón queda en espera. */
  isDeleting: boolean
  onSaveTemplate: (content: string) => void
}

/** Lápida de un mensaje eliminado para todos: ocupa el lugar del mensaje en el
 * hilo pero no muestra nada de lo que decía (el backend directamente ya no lo
 * sirve), igual que WhatsApp. */
function DeletedBody({ isVendedor }: { isVendedor: boolean }) {
  return (
    <p className="flex items-center gap-1.5 italic text-wa-muted dark:text-wa-text-dark/60">
      <Ban aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {isVendedor ? 'Eliminaste este mensaje' : 'Se eliminó este mensaje'}
    </p>
  )
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
  onPreviewSticker,
  onQuotedJump,
  onRetry,
  onStartReply,
  onReact,
  onEdit,
  onDelete,
  isDeleting,
  onSaveTemplate,
}: Props) {
  const isVendedor = m.sender === 'vendedor'
  const isDeleted = !!m.deleted_at
  const parsed = parseContent(m)
  const { kind, text, analysis, template } = parsed
  // Un eliminado no conserva reacciones, igual que en WhatsApp.
  const reactions = isDeleted ? [] : (m.reactions ?? [])
  const adReferral = messageAdReferral(parsed.payload)
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
  const canReply = m.id > 0 && !!m.wa_message_id && !isDeleted
  // WhatsApp solo deja tocar los mensajes propios ya confirmados: editar,
  // además, solo texto y dentro de los 15 minutos.
  const canDelete = canReply && isVendedor
  const sentAgo = m.sent_at ? Date.now() - new Date(m.sent_at).getTime() : Infinity
  const canEdit = canDelete && (kind === 'text') && sentAgo < EDIT_WINDOW_MS
  const actionButtonClass = 'rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark'
  const messageActions = canReply && (
    <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button
        type="button"
        onClick={onStartReply}
        aria-label="Responder a este mensaje"
        title="Responder"
        className={actionButtonClass}
      >
        <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <ReactionMenu
        ownEmoji={reactions.find((r) => r.from_me)?.emoji ?? null}
        onReact={onReact}
        side={isVendedor ? 'left' : 'right'}
      />
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label="Editar este mensaje"
          title="Editar"
          className={actionButtonClass}
        >
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
      {canDelete && (
        <ConfirmDialog
          title="Eliminar mensaje para todos"
          description="El mensaje desaparecerá también del WhatsApp del cliente, que verá 'Se eliminó este mensaje'. No se puede deshacer."
          confirmLabel="Eliminar para todos"
          disabled={isDeleting}
          onConfirm={onDelete}
        >
          <button
            type="button"
            disabled={isDeleting}
            aria-busy={isDeleting}
            aria-label="Eliminar este mensaje para todos"
            title={isDeleting ? 'Eliminando…' : 'Eliminar para todos'}
            className={`${actionButtonClass} hover:text-red-600 disabled:cursor-wait disabled:opacity-60 dark:hover:text-red-400`}
          >
            {isDeleting
              ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              : <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
          </button>
        </ConfirmDialog>
      )}
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
          {isDeleted ? (
            <DeletedBody isVendedor={isVendedor} />
          ) : (
            <>
              {adReferral && <AdReferralCard ad={adReferral} />}
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
                onPreviewSticker={onPreviewSticker}
                videoFooter={<><span>{formatMessageTime(m.sent_at)}</span>{isVendedor && <MessageStatusTicks status={m.status} onRetry={onRetry} />}</>}
                hasQuote={m.quoted_message_id != null}
              />
              {analysis && <MessageAnalysis summary={analysis} />}
            </>
          )}
          {/* El pie va embebido en el reproductor de video, salvo que el
              mensaje se haya eliminado: ahí ya no hay reproductor. */}
          {(isDeleted || kind !== 'video') && <div className="flex items-center justify-end gap-1 text-[10px] text-wa-faint dark:text-wa-text-dark/60 mt-1">
            {!isDeleted && isVendedor && kind === 'text' && text.trim() && (
              <button
                type="button"
                title="Guardar como plantilla personal"
                onClick={() => onSaveTemplate(text.trim())}
                className="mr-1 rounded p-0.5 opacity-50 transition-opacity hover:text-wa-primary-strong dark:hover:text-wa-primary hover:opacity-100"
              >
                <BookmarkPlus className="h-3 w-3" />
              </button>
            )}
            {!isDeleted && isVendedor && kind === 'audio' && m.status !== 'PENDING' && m.status !== 'FAILED' && (
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
            {!isDeleted && m.edited_at && <span title={`Editado ${formatMessageTime(m.edited_at)}`}>Editado</span>}
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
