import { useState, type ReactNode } from 'react'
import { ChevronDown, CreditCard, Download, ExternalLink, EyeOff, FileText, ReceiptText, ShoppingBag, Sparkles } from 'lucide-react'

import type { Message } from '../types'
import { isJsonObject, messageCoords, type MessageKind, type ParsedContent } from '../utils/message'
import { messageMediaFilename } from '../utils/media'
import { AudioPlayer } from './MediaPlayer'
import { ChatVideoMessage } from './ChatVideoMessage'
import { MapPreview } from './MapPreview'
import { RichText } from './RichText'
import { TemplateMessagePreview } from './TemplateMessageCard'

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

// Los navegadores solo previsualizan PDF de forma nativa; Word/Excel/etc. no
// tienen visor propio, así que para esos se fuerza la descarga directa.
function isPdfFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf')
}

export interface MessageBodyContext {
  message: Message
  parsed: ParsedContent
  /** URL de descarga del adjunto, o null si falló o no hay. */
  mediaSrc: string | null
  isVendedor: boolean
  /** Dimensiones ya calculadas para reservar el espacio de imagen/video. */
  mediaBox: { width?: number; height?: number; style?: { width: number; height: number } }
  onMediaError: () => void
  onOpenMedia: (item: { src: string; kind: 'image' | 'video'; alt: string; filename?: string }) => void
  /** Descarga directa del adjunto; permanece accesible con pantalla táctil. */
  onDownloadMedia: () => void
  /** Abre la previsualización del sticker (para verlo grande y agregarlo). */
  onPreviewSticker: (item: { src: string; mediaUrl: string }) => void
  /** Pie del video (hora + estado), que va embebido dentro del reproductor. */
  videoFooter: ReactNode
  /** El mensaje lleva un recuadro de cita arriba (ajusta el preview de plantilla). */
  hasQuote: boolean
}

type BodyRenderer = (ctx: MessageBodyContext) => ReactNode

/** Chip de "tipo de adjunto" (ícono + etiqueta) para cuando el archivo no está
 * disponible: el receptor ve al menos qué era. */
function AttachmentChip({ parsed }: { parsed: ParsedContent }) {
  const { icon: Icon, label } = parsed
  if (!Icon) return null
  return (
    <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/10 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-wa-muted dark:text-wa-text-dark/70 uppercase tracking-wide">
      <Icon className="w-3 h-3" />
      <span>{label}</span>
    </div>
  )
}

/** Párrafo de caption/cuerpo. En cursiva para los que no son texto plano
 * (epígrafes de adjuntos, texto renderizado de interactivos). */
function Caption({ parsed }: { parsed: ParsedContent }) {
  const { kind, text, template } = parsed
  if (!text) return null
  // El cuerpo de una plantilla es texto real del anuncio, no un marcador de
  // adjunto: se pinta como un mensaje normal.
  const plain = kind === 'text' || template != null
  return (
    <p className={`whitespace-pre-wrap ${plain ? '' : 'italic text-wa-muted dark:text-wa-text-dark/70'}`}>
      <RichText text={text} />
    </p>
  )
}

function TextBody({ parsed }: MessageBodyContext) {
  return <Caption parsed={parsed} />
}

function MediaDownloadButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onClick() }}
      aria-label={label}
      title="Descargar"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:h-8 sm:w-8"
    >
      <Download className="h-4 w-4" />
    </button>
  )
}

function ImageBody(ctx: MessageBodyContext) {
  const { parsed, mediaSrc, mediaBox, onMediaError, onOpenMedia, onDownloadMedia } = ctx
  const alt = parsed.text || 'Imagen'
  if (!mediaSrc) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  return (
    <>
      <div className="relative mb-1.5 w-fit max-w-full">
        <img
          src={mediaSrc}
          alt={alt}
          width={mediaBox.width}
          height={mediaBox.height}
          style={mediaBox.style}
          onClick={() => onOpenMedia({ src: mediaSrc, kind: 'image', alt, filename: messageMediaFilename(ctx.message) })}
          onError={onMediaError}
          className="max-h-80 max-w-full cursor-zoom-in rounded-lg object-contain"
        />
        <span className="absolute right-2 top-2 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <MediaDownloadButton onClick={onDownloadMedia} label="Descargar imagen" />
        </span>
      </div>
      <Caption parsed={parsed} />
    </>
  )
}

function VideoBody(ctx: MessageBodyContext) {
  const { parsed, mediaSrc, mediaBox, onMediaError, onOpenMedia, onDownloadMedia, videoFooter } = ctx
  const alt = parsed.text || 'Video'
  if (!mediaSrc) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  return (
    <>
      <div className="relative max-w-full">
        <ChatVideoMessage
          src={mediaSrc}
          alt={alt}
          onError={onMediaError}
          style={mediaBox.style}
          className={`max-w-full ${mediaBox.style ? '' : 'h-56 w-[min(100%,360px)]'}`}
          onOpenGallery={() => onOpenMedia({ src: mediaSrc, kind: 'video', alt, filename: messageMediaFilename(ctx.message) })}
          footer={videoFooter}
        />
        <span className="absolute right-2 top-2 z-10 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <MediaDownloadButton onClick={onDownloadMedia} label="Descargar video" />
        </span>
      </div>
      <Caption parsed={parsed} />
    </>
  )
}

function AudioBody(ctx: MessageBodyContext) {
  const { parsed, message, mediaSrc, onMediaError } = ctx
  if (!mediaSrc) return <AttachmentChip parsed={parsed} />
  return (
    <AudioPlayer
      src={mediaSrc}
      onError={onMediaError}
      variant="bubble"
      className="mb-1.5 min-w-[min(16rem,100%)] max-w-full"
      downloadName={messageMediaFilename(message)}
    />
  )
}

function StickerBody(ctx: MessageBodyContext) {
  const { parsed, mediaSrc, message, onMediaError, onPreviewSticker, onDownloadMedia } = ctx
  if (!mediaSrc) return <AttachmentChip parsed={parsed} />
  return (
    <div className="relative w-fit max-w-full">
      <button
        type="button"
        onClick={() => message.media_url && onPreviewSticker({ src: mediaSrc, mediaUrl: message.media_url })}
        className="block cursor-pointer transition-transform active:scale-95"
        title="Ver sticker"
      >
        <img src={mediaSrc} alt="Sticker" onError={onMediaError} className="max-h-32 max-w-[8rem] object-contain" />
      </button>
      <span className="absolute right-0 top-0 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <MediaDownloadButton onClick={onDownloadMedia} label="Descargar sticker" />
      </span>
    </div>
  )
}

function DocumentBody(ctx: MessageBodyContext) {
  const { parsed, mediaSrc, onDownloadMedia } = ctx
  const name = String((parsed.payload?.filename as string | undefined) || parsed.text || 'Documento')
  if (!mediaSrc) return <AttachmentChip parsed={parsed} />
  return (
    <div className="flex items-center gap-1 rounded-lg bg-black/5 p-1 transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15">
      <a
        href={mediaSrc}
        {...(isPdfFilename(name)
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : { download: name || true })}
        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5"
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${documentColor(name)}`}>
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium not-italic text-wa-text dark:text-wa-text-dark">{name}</p>
          <p className="text-[11px] not-italic text-wa-muted dark:text-wa-text-dark/60">{documentExtension(name)}</p>
        </div>
      </a>
      <MediaDownloadButton onClick={onDownloadMedia} label={`Descargar ${name}`} />
    </div>
  )
}

function LocationBody({ parsed }: MessageBodyContext) {
  const coords = messageCoords(parsed.payload, parsed.text)
  if (!coords) return <AttachmentChip parsed={parsed} />
  const [lat, lon] = coords
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
}

function ContactBody({ parsed }: MessageBodyContext) {
  const contacts = Array.isArray(parsed.payload?.contacts)
    ? parsed.payload.contacts.filter(isJsonObject)
    : []
  if (contacts.length === 0) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  return (
    <div className="flex flex-col gap-1">
      {contacts.map((contact, index) => (
        <div key={index} className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/10">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wa-primary/20 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
            {String(contact.fullName || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark not-italic">
              {String(contact.fullName || 'Contacto')}
            </p>
            {contact.phoneNumber != null && (
              <p className="truncate text-[11px] text-wa-muted dark:text-wa-text-dark/60 not-italic">
                {String(contact.phoneNumber)}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function PollBody({ parsed }: MessageBodyContext) {
  const values = Array.isArray(parsed.payload?.values)
    ? parsed.payload.values.map(String)
    : []
  const results = Array.isArray(parsed.payload?.results)
    ? parsed.payload.results.filter(isJsonObject)
    : []
  const counts = new Map(results.map(result => [String(result.option || ''), Number(result.count) || 0]))
  const options = values.length ? values : results.map(result => String(result.option || '')).filter(Boolean)
  const totalVotes = Array.from(counts.values()).reduce((total, count) => total + count, 0)
  return (
    <div className="flex flex-col gap-1.5">
      {parsed.text && <p className="text-sm font-medium text-wa-text dark:text-wa-text-dark">{parsed.text}</p>}
      {options.map((value, index) => {
        const count = counts.get(value) || 0
        const percent = totalVotes ? Math.round((count / totalVotes) * 100) : 0
        return (
        <div
          key={index}
          className="relative overflow-hidden rounded-lg border border-black/10 px-3 py-1.5 text-sm text-wa-text dark:border-white/15 dark:text-wa-text-dark"
        >
          {totalVotes > 0 && <span className="absolute inset-y-0 left-0 bg-wa-primary/10" style={{ width: `${percent}%` }} />}
          <span className="relative flex items-center justify-between gap-3">
            <span>{value}</span>
            {totalVotes > 0 && <span className="text-xs tabular-nums text-wa-muted">{count}</span>}
          </span>
        </div>
      )})}
      {totalVotes > 0 && <p className="text-right text-[11px] text-wa-muted">{totalVotes} {totalVotes === 1 ? 'voto' : 'votos'}</p>}
    </div>
  )
}

function orderText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function orderNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function OrderBody({ parsed }: MessageBodyContext) {
  const payload = parsed.payload
  const orderId = orderText(payload?.order_id)
  const title = orderText(payload?.title) || 'Pedido de WhatsApp'
  const detail = orderText(payload?.message) || parsed.text
  const itemCount = orderNumber(payload?.item_count)
  const amount1000 = orderNumber(payload?.total_amount_1000)
  const currency = orderText(payload?.currency)
  const status = orderText(payload?.status).replaceAll('_', ' ')
  const total = amount1000 != null
    ? `${currency || 'PEN'} ${(amount1000 / 1000).toLocaleString('es-PE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : ''

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-black/5 bg-black/5 text-wa-text dark:border-white/10 dark:bg-white/10 dark:text-wa-text-dark sm:min-w-64">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <ReceiptText className="h-4 w-4 shrink-0 text-wa-primary" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em]">
          {orderId ? `Pedido N.º ${orderId}` : 'Pedido de WhatsApp'}
        </p>
        {status && !/^\d+$/.test(status) && (
          <span className="max-w-28 truncate rounded-full bg-wa-primary/15 px-2 py-0.5 text-[10px] font-semibold capitalize text-wa-primary-strong dark:text-wa-primary">
            {status.toLocaleLowerCase('es-PE')}
          </span>
        )}
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <p className="font-medium not-italic">{title}</p>
        {detail && detail !== title && (
          <p className="whitespace-pre-wrap text-sm not-italic text-wa-muted dark:text-wa-text-dark/75">
            <RichText text={detail} />
          </p>
        )}
        {(itemCount != null || total) && (
          <div className="flex items-end justify-between gap-4 border-t border-black/5 pt-2 text-sm dark:border-white/10">
            <span className="text-wa-muted dark:text-wa-text-dark/65">
              {itemCount != null ? `Cantidad ${itemCount}` : 'Total'}
            </span>
            {total && <span className="font-semibold tabular-nums">{total}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function PtvBody(ctx: MessageBodyContext) {
  const { parsed, mediaSrc, onMediaError, onOpenMedia, onDownloadMedia, videoFooter } = ctx
  const alt = parsed.text || 'Video circular'
  if (!mediaSrc) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  return (
    <>
      <div className="relative h-56 w-56 max-w-full">
        <ChatVideoMessage
          src={mediaSrc}
          alt={alt}
          onError={onMediaError}
          className="h-56 w-56 max-w-full !rounded-full border-4 border-white/20"
          onOpenGallery={() => onOpenMedia({ src: mediaSrc, kind: 'video', alt, filename: messageMediaFilename(ctx.message) })}
          footer={videoFooter}
        />
        <span className="absolute right-2 top-4 z-10 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <MediaDownloadButton onClick={onDownloadMedia} label="Descargar video circular" />
        </span>
      </div>
      <Caption parsed={parsed} />
    </>
  )
}

function money(amount1000: number | null, currency: string): string {
  if (amount1000 == null) return ''
  return `${currency || 'PEN'} ${(amount1000 / 1000).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function ProductBody({ parsed }: MessageBodyContext) {
  const payload = parsed.payload
  const title = orderText(payload?.title) || parsed.text || 'Producto de WhatsApp'
  const description = orderText(payload?.description) || orderText(payload?.body)
  const currency = orderText(payload?.currency)
  const regularPrice = money(orderNumber(payload?.price_amount_1000), currency)
  const salePrice = money(orderNumber(payload?.sale_price_amount_1000), currency)
  const rawImageUrl = orderText(payload?.image_url)
  const imageUrl = /^(?:https?:\/\/|\/media\/)/i.test(rawImageUrl) ? rawImageUrl : ''
  const productUrl = orderText(payload?.url)

  const content = (
    <div className="min-w-0 overflow-hidden rounded-lg border border-black/5 bg-black/5 text-wa-text dark:border-white/10 dark:bg-white/10 dark:text-wa-text-dark sm:min-w-64">
      {imageUrl && <img src={imageUrl} alt={title} className="max-h-44 w-full object-cover" />}
      <div className="space-y-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-wa-primary-strong dark:text-wa-primary">
          <ShoppingBag className="h-4 w-4" /> Producto
        </div>
        <p className="font-medium not-italic">{title}</p>
        {description && description !== title && (
          <p className="line-clamp-3 text-sm not-italic text-wa-muted dark:text-wa-text-dark/70">{description}</p>
        )}
        {(salePrice || regularPrice) && (
          <div className="flex items-baseline gap-2 pt-1">
            <span className="font-semibold tabular-nums">{salePrice || regularPrice}</span>
            {salePrice && regularPrice && salePrice !== regularPrice && (
              <span className="text-xs tabular-nums text-wa-muted line-through">{regularPrice}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )

  if (!/^https?:\/\//i.test(productUrl)) return content
  return <a href={productUrl} target="_blank" rel="noopener noreferrer" className="relative block hover:opacity-90">{content}<ExternalLink className="absolute bottom-3 right-3 h-3.5 w-3.5 text-wa-muted" /></a>
}

const PAYMENT_LABELS: Record<string, string> = {
  invoice: 'Factura',
  requestPayment: 'Solicitud de pago',
  sendPayment: 'Pago enviado',
  paymentInvite: 'Invitación de pago',
  cancelPaymentRequest: 'Solicitud cancelada',
  declinePaymentRequest: 'Solicitud rechazada',
}

function PaymentBody({ parsed }: MessageBodyContext) {
  const payload = parsed.payload
  const kind = orderText(payload?.payment_kind)
  const label = PAYMENT_LABELS[kind] || 'Pago de WhatsApp'
  const amount = money(orderNumber(payload?.amount_1000), orderText(payload?.currency))
  const note = orderText(payload?.note) || parsed.text
  const status = orderText(payload?.status).replaceAll('_', ' ')
  const transactionId = orderText(payload?.transaction_id)
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-black/5 bg-black/5 text-wa-text dark:border-white/10 dark:bg-white/10 dark:text-wa-text-dark sm:min-w-64">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <CreditCard className="h-4 w-4 shrink-0 text-wa-primary" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</p>
        {status && <span className="max-w-28 truncate rounded-full bg-wa-primary/15 px-2 py-0.5 text-[10px] font-semibold capitalize text-wa-primary-strong dark:text-wa-primary">{status.toLocaleLowerCase('es-PE')}</span>}
      </div>
      <div className="space-y-1.5 px-3 py-2.5">
        {amount && <p className="text-lg font-semibold tabular-nums not-italic">{amount}</p>}
        {note && note !== label && <p className="whitespace-pre-wrap text-sm not-italic"><RichText text={note} /></p>}
        {transactionId && <p className="truncate text-[10px] text-wa-muted dark:text-wa-text-dark/60">ID: {transactionId}</p>}
      </div>
    </div>
  )
}

const VIEW_ONCE_LABELS: Record<string, string> = {
  image: 'Imagen de visualización única',
  video: 'Video de visualización única',
  ptv: 'Video circular de visualización única',
  audio: 'Audio de visualización única',
  document: 'Documento de visualización única',
}

/** WhatsApp no permite conservar ni volver a abrir este adjunto desde el CRM.
 * La tarjeta informa qué llegó, pero deliberadamente no recibe mediaSrc. */
function ViewOnceBody({ parsed }: MessageBodyContext) {
  const innerType = orderText(parsed.payload?.inner_type)
  const label = VIEW_ONCE_LABELS[innerType] || 'Multimedia de visualización única'
  return (
    <div className="min-w-0 max-w-full rounded-lg border border-black/5 bg-black/5 px-3 py-2.5 text-wa-text dark:border-white/10 dark:bg-white/10 dark:text-wa-text-dark sm:min-w-64">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-primary/15 text-wa-primary-strong dark:text-wa-primary">
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium not-italic">{label}</p>
          <p className="mt-0.5 text-xs not-italic text-wa-muted dark:text-wa-text-dark/65">
            Solo puede abrirse en WhatsApp. No se guarda ni se puede descargar desde el CRM.
          </p>
        </div>
      </div>
      {parsed.text && (
        <p className="mt-2 whitespace-pre-wrap border-t border-black/5 pt-2 text-sm not-italic dark:border-white/10">
          <RichText text={parsed.text} />
        </p>
      )}
    </div>
  )
}

/** Fallback para tipos que se muestran como texto renderizado + chip del tipo:
 * reacciones y lo no soportado. */
function TextualBody(ctx: MessageBodyContext) {
  return (
    <>
      <AttachmentChip parsed={ctx.parsed} />
      <Caption parsed={ctx.parsed} />
    </>
  )
}

/** Plantillas y mensajes con botones: preview del enlace (si el JSON trajo
 * uno), el cuerpo como texto normal y el pie. Los botones en sí van FUERA de
 * la burbuja (los pinta MessageBubble debajo), como en WhatsApp. */
function TemplateBody(ctx: MessageBodyContext) {
  const { parsed, hasQuote } = ctx
  return (
    <>
      {parsed.template && <TemplateMessagePreview template={parsed.template} hasQuote={hasQuote} />}
      {!parsed.template && <AttachmentChip parsed={parsed} />}
      <Caption parsed={parsed} />
      {parsed.template?.footer && (
        <p className="mt-0.5 text-[11px] text-wa-muted dark:text-wa-text-dark/60">{parsed.template.footer}</p>
      )}
    </>
  )
}

/** Registro de estrategias de render por tipo. Agregar un tipo = sumar una
 * entrada, sin tocar condicionales repartidos por la burbuja. */
const BODY_RENDERERS: Record<MessageKind, BodyRenderer> = {
  text: TextBody,
  image: ImageBody,
  video: VideoBody,
  ptv: PtvBody,
  audio: AudioBody,
  sticker: StickerBody,
  document: DocumentBody,
  location: LocationBody,
  contact: ContactBody,
  poll: PollBody,
  interactive: TemplateBody,
  template: TemplateBody,
  order: OrderBody,
  product: ProductBody,
  payment: PaymentBody,
  view_once: ViewOnceBody,
  reaction: TextualBody,
  unsupported: TextualBody,
}

export function MessageBody(ctx: MessageBodyContext) {
  const Renderer = BODY_RENDERERS[ctx.parsed.kind]
  return <Renderer {...ctx} />
}

/** Análisis IA del adjunto (descripción/transcripción), plegado por defecto:
 * el vendedor lo ve solo si lo despliega, nunca pegado dentro de la burbuja. */
export function MessageAnalysis({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-wa-primary-strong transition-colors hover:bg-black/5 dark:text-wa-primary dark:hover:bg-white/10"
      >
        <Sparkles className="h-3 w-3" />
        Análisis IA
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-black/5 px-2 py-1.5 text-xs italic text-wa-muted dark:bg-white/10 dark:text-wa-text-dark/70">
          {summary}
        </p>
      )}
    </div>
  )
}
