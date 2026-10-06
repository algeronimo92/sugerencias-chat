import {
AlertTriangle,ChevronDown,CornerUpLeft,Download,FileText,Info,LayoutGrid,PhoneCall,
ReceiptText,ShoppingBag,Sparkles,Workflow,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { MapPreview } from '../../../shared/ui/MapPreview'
import { AudioPlayer } from '../../../shared/ui/MediaPlayer'
import type { Message } from '../types'
import {
formatMoney,messageContacts,messageCoords,
messageFilename,
messageFlowReply,messageOrder,messageProducts,
messageReply,messageSystemNotice,metaErrors,
type MessageKind,type ParsedContent,
} from '../utils/message'
import { messageMediaFilename } from '../utils/messageMedia'
import { ChatVideoMessage } from './ChatVideoMessage'
import { ContactCard } from './ContactCard'
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
  /** El mensaje lleva un recuadro de cita arriba. */
  hasQuote: boolean
}

type BodyRenderer = (ctx: MessageBodyContext) => ReactNode

/** Chip de "tipo de mensaje" (ícono + etiqueta) para cuando no hay contenido
 * que mostrar: el receptor ve al menos qué era. */
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
 * (epígrafes de adjuntos). */
function Caption({ parsed }: { parsed: ParsedContent }) {
  const { kind, text, template } = parsed
  if (!text) return null
  const plain = kind === 'text' || template != null
  return (
    <p className={`whitespace-pre-wrap break-words ${plain ? '' : 'italic text-wa-muted dark:text-wa-text-dark/70'}`}>
      <RichText text={text} />
    </p>
  )
}

/** Tarjeta con encabezado de color, compartida por pedidos, productos y
 * formularios: el mismo lenguaje visual que las tarjetas de WhatsApp. */
function Card({ icon: Icon, title, badge, children }: {
  icon: typeof ReceiptText
  title: string
  badge?: string
  children?: ReactNode
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-black/5 bg-black/5 text-wa-text dark:border-white/10 dark:bg-white/10 dark:text-wa-text-dark sm:min-w-64">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <Icon className="h-4 w-4 shrink-0 text-wa-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</p>
        {badge && (
          <span className="max-w-32 truncate rounded-full bg-wa-primary/15 px-2 py-0.5 text-[10px] font-semibold text-wa-primary-strong dark:text-wa-primary">
            {badge}
          </span>
        )}
      </div>
      {children && <div className="space-y-2 px-3 py-2.5">{children}</div>}
    </div>
  )
}

function TextBody(ctx: MessageBodyContext) {
  const products = messageProducts(ctx.parsed)
  return (
    <>
      {products.length > 0 && <ProductReferences parsed={ctx.parsed} title="Consulta sobre un producto" />}
      <Caption parsed={ctx.parsed} />
    </>
  )
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

function documentName(parsed: ParsedContent): string {
  return messageFilename(parsed) || parsed.text || 'Documento'
}

function DocumentBody(ctx: MessageBodyContext) {
  const { parsed, mediaSrc, onDownloadMedia } = ctx
  const name = documentName(parsed)
  if (!mediaSrc) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  const caption = parsed.text && parsed.text !== name ? parsed : null
  return (
    <>
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
      {caption && <Caption parsed={caption} />}
    </>
  )
}

function LocationBody({ parsed }: MessageBodyContext) {
  const coords = messageCoords(parsed.meta)
  if (!coords) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  const [lat, lon] = coords
  return (
    <>
      <a
        href={`https://www.google.com/maps?q=${lat},${lon}`}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block w-56 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
      >
        <MapPreview latitude={lat} longitude={lon} className="rounded-lg" />
      </a>
      {parsed.text && <p className="mt-1 text-sm font-medium not-italic">{parsed.text}</p>}
    </>
  )
}

function ContactsBody({ parsed }: MessageBodyContext) {
  const contacts = messageContacts(parsed.meta)
  if (contacts.length === 0) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  return <ContactCard contacts={contacts} />
}

/** Lo que tocó el cliente: un botón de respuesta rápida de una plantilla
 * (`button`), un botón de un interactivo (`button_reply`) o una opción de
 * una lista (`list_reply`). El id o payload literal queda a la vista porque
 * es lo que usan las automatizaciones para ramificar. */
function ReplyBody({ parsed }: MessageBodyContext) {
  const reply = messageReply(parsed)
  if (!reply || !reply.title) return <><AttachmentChip parsed={parsed} /><Caption parsed={parsed} /></>
  return (
    <div className="flex min-w-0 items-start gap-2">
      <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-wa-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="whitespace-pre-wrap break-words">{reply.title}</p>
        {reply.description && (
          <p className="text-xs text-wa-muted dark:text-wa-text-dark/70">{reply.description}</p>
        )}
        {reply.id && reply.id !== reply.title && (
          <p className="truncate text-[10px] text-wa-faint dark:text-wa-text-dark/50" title="Id que recibe la automatización">
            {parsed.kind === 'button' ? 'Payload' : 'Id'}: {reply.id}
          </p>
        )}
      </div>
    </div>
  )
}

function FlowReplyBody({ parsed }: MessageBodyContext) {
  const reply = messageFlowReply(parsed.meta)
  return (
    <Card icon={Workflow} title={reply.name && reply.name !== 'flow' ? `Formulario ${reply.name}` : 'Formulario completado'}>
      {reply.body && <p className="text-sm not-italic">{reply.body}</p>}
      {reply.fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {reply.fields.map((field) => (
            <div key={field.key} className="contents">
              <dt className="text-wa-muted dark:text-wa-text-dark/65">{field.key}</dt>
              <dd className="min-w-0 break-words font-medium">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-wa-muted dark:text-wa-text-dark/65">Sin datos en la respuesta.</p>
      )}
    </Card>
  )
}

function ProductReferences({ parsed, title }: { parsed: ParsedContent; title: string }) {
  const products = messageProducts(parsed)
  if (!products.length) return null
  return (
    <div className="mb-1.5">
      <Card icon={ShoppingBag} title={title} badge={products.length > 1 ? `${products.length} productos` : undefined}>
        <ul className="space-y-0.5 text-sm">
          {products.map((product, index) => (
            <li key={`${product.sku}-${index}`} className="truncate">
              <span className="font-medium">{product.sku || 'Producto sin código'}</span>
            </li>
          ))}
        </ul>
        {products[0].catalogId && (
          <p className="text-[10px] text-wa-faint dark:text-wa-text-dark/50">Catálogo {products[0].catalogId}</p>
        )}
      </Card>
    </div>
  )
}

/** Interactivos que manda el negocio: botones y lista se pintan como la
 * tarjeta de WhatsApp (los botones van debajo de la burbuja); productos,
 * catálogo, Flow y permiso de llamada muestran qué se ofreció. */
function OutboundInteractiveBody(ctx: MessageBodyContext) {
  const { parsed } = ctx
  const template = parsed.template
  const subtype = parsed.subtype
  if (subtype === 'product' || subtype === 'product_list') {
    return <><ProductReferences parsed={parsed} title={subtype === 'product' ? 'Producto' : 'Productos'} /><InteractiveText parsed={parsed} /></>
  }
  if (subtype === 'catalog_message') {
    return <><Card icon={LayoutGrid} title="Catálogo" /><InteractiveText parsed={parsed} /></>
  }
  if (subtype === 'call_permission_request') {
    return <><Card icon={PhoneCall} title="Permiso para llamar" /><InteractiveText parsed={parsed} /></>
  }
  if (subtype === 'flow') {
    return <><Card icon={Workflow} title="Formulario" /><InteractiveText parsed={parsed} /></>
  }
  return <InteractiveText parsed={parsed} withTitle={!!template?.title} />
}

function InteractiveText({ parsed, withTitle = true }: { parsed: ParsedContent; withTitle?: boolean }) {
  const template = parsed.template
  return (
    <>
      {withTitle && template?.title && (
        <p className="text-[13px] font-semibold text-wa-text dark:text-wa-text-dark">{template.title}</p>
      )}
      <Caption parsed={parsed} />
      {template?.footer && (
        <p className="mt-0.5 text-[11px] text-wa-muted dark:text-wa-text-dark/60">{template.footer}</p>
      )}
    </>
  )
}

const INTERACTIVE_RENDERERS: Record<string, BodyRenderer> = {
  button_reply: ReplyBody,
  list_reply: ReplyBody,
  nfm_reply: FlowReplyBody,
  button: OutboundInteractiveBody,
  list: OutboundInteractiveBody,
  product: OutboundInteractiveBody,
  product_list: OutboundInteractiveBody,
  catalog_message: OutboundInteractiveBody,
  flow: OutboundInteractiveBody,
  call_permission_request: OutboundInteractiveBody,
}

function InteractiveBody(ctx: MessageBodyContext) {
  const Renderer = (ctx.parsed.subtype && INTERACTIVE_RENDERERS[ctx.parsed.subtype]) || UnrenderedBody
  return <Renderer {...ctx} />
}

function OrderBody({ parsed }: MessageBodyContext) {
  const order = messageOrder(parsed.meta)
  return (
    <Card icon={ReceiptText} title="Pedido" badge={order.items.length ? `${order.items.length} ${order.items.length === 1 ? 'producto' : 'productos'}` : undefined}>
      {order.text && <p className="whitespace-pre-wrap text-sm not-italic"><RichText text={order.text} /></p>}
      {order.items.length > 0 && (
        <ul className="space-y-1 text-sm">
          {order.items.map((item, index) => (
            <li key={`${item.sku}-${index}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {item.quantity != null && <span className="tabular-nums">{item.quantity} × </span>}
                <span className="font-medium">{item.sku}</span>
              </span>
              {item.price != null && (
                <span className="shrink-0 tabular-nums text-wa-muted dark:text-wa-text-dark/70">
                  {formatMoney(item.price, item.currency)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {order.totals.map((total) => (
        <div key={total.currency} className="flex items-end justify-between gap-4 border-t border-black/5 pt-2 text-sm dark:border-white/10">
          <span className="text-wa-muted dark:text-wa-text-dark/65">Total</span>
          <span className="font-semibold tabular-nums">{formatMoney(total.amount, total.currency)}</span>
        </div>
      ))}
    </Card>
  )
}

/** Plantilla oficial enviada: encabezado de imagen o texto, cuerpo y pie. Los
 * botones van FUERA de la burbuja (los pinta MessageBubble), como WhatsApp. */
function TemplateBody({ parsed }: MessageBodyContext) {
  const template = parsed.template
  return (
    <>
      {template && <TemplateMessagePreview template={template} />}
      <Caption parsed={parsed} />
      {template?.footer && (
        <p className="mt-0.5 text-[11px] text-wa-muted dark:text-wa-text-dark/60">{template.footer}</p>
      )}
    </>
  )
}

/** Aviso de WhatsApp (cambio de número, etc.): informativo, no un mensaje
 * que el cliente escribió. */
function SystemBody({ parsed }: MessageBodyContext) {
  const notice = messageSystemNotice(parsed.meta)
  return (
    <p className="flex items-start gap-1.5 text-sm italic text-wa-muted dark:text-wa-text-dark/70">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{notice.body || parsed.text || 'Aviso de WhatsApp'}</span>
    </p>
  )
}

/** `unknown`/`unsupported` (Meta no pudo leer el mensaje) y tipos que el
 * contrato todavía no conoce: se nombra el tipo literal y se muestran los
 * errores y el texto disponibles, nunca se descarta el mensaje. */
function UnrenderedBody({ parsed }: MessageBodyContext) {
  const errors = metaErrors(parsed.meta)
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-wa-muted dark:text-wa-text-dark/70">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {parsed.label}
      </p>
      {errors.map((error, index) => (
        <p key={index} className="text-xs text-wa-muted dark:text-wa-text-dark/70">
          {[error.title, error.details].filter(Boolean).join(': ')}{error.code ? ` (${error.code})` : ''}
        </p>
      ))}
      <Caption parsed={parsed} />
    </div>
  )
}

/** Un renderer por raíz de Meta. Agregar un tipo = sumar una entrada; lo que
 * no está acá (un tipo nuevo) cae a `UnrenderedBody`. */
const BODY_RENDERERS: Record<string, BodyRenderer> = {
  text: TextBody,
  image: ImageBody,
  video: VideoBody,
  audio: AudioBody,
  sticker: StickerBody,
  document: DocumentBody,
  location: LocationBody,
  contacts: ContactsBody,
  interactive: InteractiveBody,
  button: ReplyBody,
  order: OrderBody,
  template: TemplateBody,
  system: SystemBody,
  unknown: UnrenderedBody,
  unsupported: UnrenderedBody,
}

export function MessageBody(ctx: MessageBodyContext) {
  const kind: MessageKind = ctx.parsed.kind
  const Renderer = (ctx.parsed.known && BODY_RENDERERS[kind]) || UnrenderedBody
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
