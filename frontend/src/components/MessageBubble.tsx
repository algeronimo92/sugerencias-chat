import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertCircle, Ban, BookmarkPlus, Check, CheckCheck, CircleCheck, CornerUpLeft, Download, Forward, Loader2, Pencil, Pin, PinOff, RefreshCw, Trash2 } from 'lucide-react'
import type { Chat, Message, MessageStatus } from '../types'
import { displayName } from '../utils/chat'
import { formatMessageTime, messageAdReferral, parseContent, resolveMediaUrl } from '../utils/message'
import { AdReferralCard } from './AdReferralCard'
import { MessageActionsMenu, type MessageMenuAction } from './MessageActionsMenu'
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
  filename?: string
}

/** Tique simple = enviado, doble gris = entregado, doble azul = visto por el
 * cliente. En audios, PLAYED agrega además una confirmación visible de que
 * el destinatario reprodujo la nota de voz. */
export function MessageStatusTicks({ status, isAudio = false, errorDetail, onRetry, onDiscard }: { status: MessageStatus; isAudio?: boolean; errorDetail?: string | null; onRetry?: () => void; onDiscard?: () => void }) {
  if (status === 'PENDING') {
    return <span className="inline-flex items-center gap-1 text-wa-faint dark:text-wa-text-dark/60" aria-label="Enviando" title="Enviando"><Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> Enviando</span>
  }
  if (status === 'FAILED') {
    // Sin motivo real (mensajes viejos, o un fallo que no llegó a dejar
    // last_error), se conserva el genérico de siempre. Con motivo, se suma
    // como tooltip: el rótulo compacto no cambia porque tiene que caber al
    // lado de la hora.
    const ariaLabel = errorDetail
      ? `No se pudo confirmar el envío: ${errorDetail}. Reintentar`
      : 'No se pudo confirmar el envío. Reintentar'
    return (
      <span className="inline-flex items-center gap-1.5">
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-red-500 hover:text-red-600" aria-label={ariaLabel} title={errorDetail || 'Reintentar envío'}>
          <RefreshCw aria-hidden="true" className="h-3 w-3" /> No enviado · Reintentar
        </button>
        <span aria-hidden="true" className="text-wa-faint dark:text-wa-text-dark/60">·</span>
        <button type="button" onClick={onDiscard} className="text-wa-faint hover:text-wa-muted dark:text-wa-text-dark/60 dark:hover:text-wa-text-dark" aria-label="Descartar el envío fallido" title="Descartar: no reintentar este mensaje">
          Descartar
        </button>
      </span>
    )
  }
  // Distinto de FAILED: acá el mensaje sí se despachó (hay wa_message_id) y
  // Meta avisó después, de forma asíncrona, que no pudo entregarlo (fuera de
  // ventana de 24h, plantilla no aprobada, número inválido...). No hay un
  // job de outbox en 'failed' al que volver, así que no hay botón de
  // reintento acá — "reintentar" significaría mandar un mensaje nuevo.
  if (status === 'REJECTED') {
    return <span className="inline-flex items-center gap-1 text-red-500" aria-label="Meta no pudo entregar este mensaje" title="Meta no pudo entregar este mensaje (ventana de 24h o plantilla no aprobada)"><AlertCircle aria-hidden="true" className="h-3 w-3" /> No entregado</span>
  }
  // El mensaje nunca llegó, pero alguien ya decidió que no se reenvía: se
  // dice, sin el rojo de lo que reclama acción ni el botón de reintento.
  if (status === 'DISCARDED') {
    return <span className="inline-flex items-center gap-1 text-wa-faint dark:text-wa-text-dark/60" aria-label="No enviado, descartado" title="No se envió y se descartó: no se va a reintentar"><Ban aria-hidden="true" className="h-3 w-3" /> No enviado · Descartado</span>
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
  /** Mensajes ya cargados del chat, para correlacionar los pedidos de
   * WhatsApp Flow que llegan repartidos en 3 mensajes con el mismo
   * `reference_id` (ver `flowOrderGroup` en utils/message). Opcional: sin
   * esto la tarjeta de pedido solo ve su propio mensaje. */
  chatMessages?: Message[]
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
  /** Cierra un envío fallido que no se va a reintentar. */
  onDiscard: () => void
  onStartReply: () => void
  onReact: (emoji: string) => void
  onEdit: () => void
  onDelete: () => void
  onForward: () => void
  /** Guarda el adjunto de este mensaje. Solo se ofrece cuando hay media. */
  onDownload: () => void
  /** El borrado en WhatsApp está en curso: el botón queda en espera. */
  isDeleting: boolean
  /** Fijado nativo del CRM: no hay forma de mandarlo hacia WhatsApp (ver
   * MessageActionsMenu más abajo), así que solo pega contra la base propia. */
  onPin: () => void
  onUnpin: () => void
  onSaveTemplate: (content: string) => void
  /** El hilo está en modo selección (hay al menos un mensaje tildado): las
   * burbujas dejan de abrir media y pasan a tildarse al tocarlas. */
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}

// Cuánto hay que mantener apretada una burbuja para entrar en modo selección,
// como en WhatsApp. En escritorio también existe el botón del hover.
const LONG_PRESS_MS = 450
// Movimiento a partir del cual se entiende que el dedo está haciendo scroll y
// no manteniendo apretado.
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

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
  chatMessages,
  isFirstOfGroup,
  isFlashing,
  threadWidth,
  hasFailedMedia,
  onMediaFailed,
  onOpenMedia,
  onPreviewSticker,
  onQuotedJump,
  onRetry,
  onDiscard,
  onStartReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
  onDownload,
  isDeleting,
  onPin,
  onUnpin,
  onSaveTemplate,
  selectionMode,
  isSelected,
  onToggleSelect,
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

  // Mantener apretada una burbuja abre el modo selección, como WhatsApp en el
  // teléfono. El timer se cancela si el dedo se mueve (eso es scroll, no una
  // pulsación larga) o si se levanta antes de tiempo. Con mouse no aplica: en
  // escritorio la selección se abre desde el botón del hover.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null)
  // El navegador dispara igual el click al levantar el dedo. Sin esta marca,
  // ese click volvería a tildar el mensaje que la pulsación larga acaba de
  // seleccionar — es decir, lo destildaría en el acto.
  const longPressSelected = useRef(false)

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
    longPressOrigin.current = null
  }

  // Un timer vivo tras desmontar la burbuja tildaría un mensaje que ya no está
  // en pantalla (pasa al recargar el hilo mientras el dedo sigue apoyado).
  useEffect(() => cancelLongPress, [])

  function startLongPress(event: ReactPointerEvent) {
    longPressSelected.current = false
    if (!canForward || selectionMode || event.pointerType === 'mouse') return
    longPressOrigin.current = { x: event.clientX, y: event.clientY }
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null
      longPressSelected.current = true
      onToggleSelect()
    }, LONG_PRESS_MS)
  }

  function trackLongPress(event: ReactPointerEvent) {
    const origin = longPressOrigin.current
    if (!origin) return
    const moved = Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_TOLERANCE_PX
      || Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE_PX
    if (moved) cancelLongPress()
  }

  function handleRowClick() {
    if (longPressSelected.current) {
      longPressSelected.current = false
      return
    }
    if (selectionMode && canForward) onToggleSelect()
  }

  /** Aparece al pasar el mouse por la burbuja, del lado de afuera, para no
   * tapar el contenido. Queda visible al enfocarlo con el teclado.
   *
   * Solo se puede citar un mensaje que ya existe en WhatsApp: sin
   * wa_message_id (envío en curso, fallido, o histórico previo a la
   * integración) el botón no aparece en vez de fallar al enviar. */
  const canReply = m.id > 0 && !!m.wa_message_id && !isDeleted
  // Reenviar y seleccionar solo necesitan que el mensaje exista en la base con
  // su contenido: se manda una copia nueva, no se toca el original en WhatsApp.
  const canForward = m.id > 0 && !isDeleted
  // Defensa adicional: aunque una integración futura mande media_url por
  // error, un view-once nunca ofrece una copia descargable.
  const canDownload = mediaSrc != null && kind !== 'view_once' && !isDeleted
  // WhatsApp solo deja tocar los mensajes propios ya confirmados: editar,
  // además, solo texto y dentro de los 15 minutos.
  const canDelete = canReply && isVendedor
  const sentAgo = m.sent_at ? Date.now() - new Date(m.sent_at).getTime() : Infinity
  const canEdit = canDelete && (kind === 'text') && sentAgo < EDIT_WINDOW_MS
  // Fijar es nativo del CRM (ver MessageActionsMenu): no depende de WhatsApp,
  // así que alcanza con que el mensaje exista y no esté eliminado — a
  // diferencia de responder/reenviar, no hace falta wa_message_id.
  const canPin = m.id > 0 && !isDeleted
  const isPinned = !!m.pinned_at
  const isForwarded = m.payload?.forwarded === true && !isDeleted
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const actionButtonClass = 'rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark'

  // Solo Responder/Reaccionar/Reenviar quedan sueltas al pasar el mouse; el
  // resto vive detrás del "⋮" de MessageActionsMenu para no llenar la burbuja
  // de íconos — mismo criterio que ya usa WhatsApp Web para esto.
  const menuActions: MessageMenuAction[] = []
  if (canDownload) menuActions.push({ key: 'download', icon: Download, label: 'Descargar', onClick: onDownload })
  if (canForward) menuActions.push({ key: 'select', icon: CircleCheck, label: 'Seleccionar', onClick: onToggleSelect })
  if (canPin) menuActions.push({
    key: 'pin',
    icon: isPinned ? PinOff : Pin,
    label: isPinned ? 'Desfijar mensaje' : 'Fijar mensaje',
    onClick: isPinned ? onUnpin : onPin,
  })
  if (canEdit) menuActions.push({ key: 'edit', icon: Pencil, label: 'Editar', onClick: onEdit })
  if (canDelete) menuActions.push({
    key: 'delete',
    icon: Trash2,
    label: isDeleting ? 'Eliminando…' : 'Eliminar para todos',
    danger: true,
    disabled: isDeleting,
    onClick: () => setShowDeleteConfirm(true),
  })

  const messageActions = (canReply || canForward) && !selectionMode && (
    <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      {canReply && (
        <button
          type="button"
          onClick={onStartReply}
          aria-label="Responder a este mensaje"
          title="Responder"
          className={actionButtonClass}
        >
          <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
      {canReply && (
        <ReactionMenu
          ownEmoji={reactions.find((r) => r.from_me)?.emoji ?? null}
          onReact={onReact}
          side={isVendedor ? 'left' : 'right'}
        />
      )}
      {canForward && <button
          type="button"
          onClick={onForward}
          aria-label="Reenviar este mensaje"
          title="Reenviar"
          className={actionButtonClass}
        >
          <Forward aria-hidden="true" className="h-3.5 w-3.5" />
        </button>}
      <MessageActionsMenu actions={menuActions} side={isVendedor ? 'left' : 'right'} />
    </div>
  )

  return (
    <>
    <div
      className={`group flex items-center gap-1 ${isVendedor ? 'justify-end' : 'justify-start'} ${isFirstOfGroup ? 'mt-3' : 'mt-[3px]'} ${reactions.length > 0 ? 'mb-2.5' : ''} ${
        selectionMode
          ? `-mx-3 select-none px-3 sm:-mx-6 sm:px-6 ${isSelected ? 'bg-wa-primary/10 dark:bg-wa-primary/15' : ''} ${canForward ? 'cursor-pointer' : 'cursor-default'}`
          : ''
      }`}
      data-message-id={m.id}
      onPointerDown={startLongPress}
      onPointerMove={trackLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onClick={canForward ? handleRowClick : undefined}
      onKeyDown={selectionMode && canForward
        ? event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onToggleSelect()
          }
        : undefined}
      role={selectionMode && canForward ? 'button' : undefined}
      tabIndex={selectionMode && canForward ? 0 : undefined}
      aria-pressed={selectionMode && canForward ? isSelected : undefined}
      aria-label={selectionMode && canForward ? 'Seleccionar mensaje' : undefined}
    >
      {selectionMode && (
        <span
          aria-hidden="true"
          className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${isVendedor ? 'mr-auto' : ''} ${
            !canForward
              ? 'border-transparent'
              : isSelected
                ? 'border-wa-primary bg-wa-primary text-white'
                : 'border-wa-muted/50 dark:border-wa-muted-dark/60'
          }`}
        >
          {canForward && isSelected && <Check className="h-3 w-3" />}
        </span>
      )}
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
          {/* En modo selección la burbuja entera deja de ser interactiva: esta
              capa se come el click para que tocar una imagen tilde el mensaje
              en vez de abrir el visor, y lo mismo con links y botones. */}
          {selectionMode && <span aria-hidden="true" className="absolute inset-0 z-20 rounded-bubble" />}
          {isDeleted ? (
            <DeletedBody isVendedor={isVendedor} />
          ) : (
            <>
              {isForwarded && (
                <p className="flex items-center gap-1 text-xs italic text-wa-muted dark:text-wa-text-dark/60">
                  <Forward aria-hidden="true" className="h-3 w-3 shrink-0" />
                  Reenviado
                </p>
              )}
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
                chatMessages={chatMessages}
                mediaSrc={mediaSrc}
                isVendedor={isVendedor}
                mediaBox={mediaBoxDimensions()}
                onMediaError={onMediaFailed}
                onOpenMedia={onOpenMedia}
                onDownloadMedia={onDownload}
                onPreviewSticker={onPreviewSticker}
                videoFooter={<><span>{formatMessageTime(m.sent_at)}</span>{isVendedor && <MessageStatusTicks status={m.status} errorDetail={m.error_detail} onRetry={onRetry} onDiscard={onDiscard} />}</>}
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
            {!isDeleted && isVendedor && kind === 'audio' && m.status !== 'PENDING' && m.status !== 'FAILED' && m.status !== 'DISCARDED' && (
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
            {isVendedor && <MessageStatusTicks status={m.status} isAudio={kind === 'audio'} errorDetail={m.error_detail} onRetry={onRetry} onDiscard={onDiscard} />}
          </div>}
          <ReactionBadge reactions={reactions} isVendedor={isVendedor} />
        </div>
        {(kind === 'template' || kind === 'interactive') && template && (
          <TemplateMessageButtons template={template} isVendedor={isVendedor} />
        )}
      </div>
      {!isVendedor && messageActions}
    </div>
    {canDelete && (
      <ConfirmDialog
        title="Eliminar mensaje para todos"
        description="El mensaje desaparecerá también del WhatsApp del cliente, que verá 'Se eliminó este mensaje'. No se puede deshacer."
        confirmLabel="Eliminar para todos"
        disabled={isDeleting}
        onConfirm={onDelete}
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      />
    )}
    </>
  )
}
