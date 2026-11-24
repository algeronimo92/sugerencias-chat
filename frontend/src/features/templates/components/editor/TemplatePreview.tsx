import { CheckCheck, CornerUpLeft, ExternalLink, FileText, Image as ImageIcon, List, Phone } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '../../../../shared/utils/cn'
import type { MediaAsset } from '../../../media/types'
import { parseRichText, resolveMediaUrl } from '../../../whatsapp/public/message'
import { captionIndex, draftContentType, draftFilename, type DraftAttachment } from '../../domain/attachmentDraft'
import { previewOf, type PreviewButton, type TemplatePreviewModel } from '../../domain/templatePreview'
import type { TemplateFormState } from '../../domain/templateForm'

const BUTTON_ICON = { reply: CornerUpLeft, url: ExternalLink, phone: Phone, list: List } as const

const SEGMENT_CLASS = {
  text: '',
  link: 'text-info-fg underline',
  bold: 'font-semibold',
  italic: 'italic',
  strike: 'line-through',
  code: 'font-mono text-[0.92em]',
} as const

/** El texto con el formato de WhatsApp aplicado (`*negrita*`, `_cursiva_`),
 *  como lo dibuja el teléfono del cliente. */
function RichText({ text }: { text: string }) {
  let offset = 0
  return <>{parseRichText(text).map(segment => {
    // La posición del tramo dentro del texto: única y estable mientras el
    // texto no cambie.
    const key = `${offset}:${segment.type}`
    offset += segment.text.length
    return <span key={key} className={SEGMENT_CLASS[segment.type]}>{segment.text}</span>
  })}</>
}

function imageUrlOf(item: DraftAttachment): string | null {
  if (!draftContentType(item).startsWith('image/')) return null
  const url = item.source === 'saved' ? item.attachment.media_url : item.source === 'library' ? item.asset.media_url : null
  return url ? resolveMediaUrl(url) ?? null : null
}

/** Dónde se mira el mensaje: en el teléfono del cliente llega como burbuja
 *  recibida; en el chat del lead (el del CRM) queda como enviada. */
export type PreviewView = 'phone' | 'chat'

const SURFACE: Record<PreviewView, string> = { phone: 'bg-bubble-in', chat: 'bg-bubble-out' }

function ButtonRow({ button, view }: { button: PreviewButton; view: PreviewView }) {
  const Icon = BUTTON_ICON[button.kind]
  return (
    <div className={cn('flex w-full max-w-[19rem] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-info-fg shadow-sm', SURFACE[view])}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{button.text}</span>
    </div>
  )
}

/** Un archivo de la plantilla; el que lleva el texto lo muestra como pie. */
function FileBubble({ item, caption, view }: { item: DraftAttachment; caption: string | null; view: PreviewView }) {
  const url = imageUrlOf(item)
  const Icon = draftContentType(item).startsWith('image/') ? ImageIcon : FileText
  return (
    <div className={cn('w-full max-w-[19rem] rounded-lg p-1 shadow-sm', SURFACE[view])}>
      {url
        ? <img src={url} alt="" className="max-h-48 w-full rounded-md object-cover" />
        : (
          <div className="flex items-center gap-2 rounded-md bg-subtle px-3 py-3 text-fg-muted">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate text-xs">{draftFilename(item)}</span>
          </div>
        )}
      {caption !== null && <p className="whitespace-pre-wrap break-words px-1.5 pb-1 pt-1.5"><RichText text={caption} /></p>}
    </div>
  )
}

/** La burbuja del mensaje: encabezado, texto y pie. */
function MessageBubble({ preview, headerUrl, view }: { preview: TemplatePreviewModel; headerUrl: string | null; view: PreviewView }) {
  const missingImage = preview.headerImageAssetId != null && !headerUrl
  return (
    <div className={cn('w-full max-w-[19rem] rounded-lg px-2.5 pb-1.5 pt-2 shadow-sm', SURFACE[view])}>
      {headerUrl && <img src={headerUrl} alt="" className="mb-1.5 max-h-48 w-full rounded-md object-cover" />}
      {missingImage && (
        <div className="mb-1.5 flex items-center gap-2 rounded-md bg-subtle px-3 py-3 text-xs text-fg-muted"><ImageIcon className="h-4 w-4" aria-hidden="true" />Imagen del encabezado</div>
      )}
      {preview.header && <p className="mb-1 break-words font-semibold">{preview.header}</p>}
      {preview.body.trim()
        ? <p className="whitespace-pre-wrap break-words"><RichText text={preview.body} /></p>
        : <p className="text-fg-muted">Aquí aparecerá tu mensaje.</p>}
      {preview.footer && <p className="mt-1.5 break-words text-xs text-bubble-meta">{preview.footer}</p>}
      <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-bubble-meta" aria-hidden="true">
        10:24
        {view === 'chat' && <CheckCheck className="h-3.5 w-3.5 text-info-fg" />}
      </p>
    </div>
  )
}

/** Un selector de dos o más opciones, como pestañas chicas. */
function Segmented<T extends string | boolean>({ label, options, value, onChange }: {
  label: string
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-lg bg-subtle p-1">
      {options.map(([option, text]) => (
        <button
          key={text}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'h-8 rounded-md px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            value === option ? 'bg-surface font-semibold text-fg shadow-sm' : 'font-medium text-fg-muted hover:text-fg',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

const VIEW_OPTIONS = [['phone', 'Teléfono del cliente'], ['chat', 'Chat del lead']] as const
const DATA_OPTIONS = [[true, 'Con datos'], [false, 'Sin datos']] as const

const VIEW_TITLE: Record<PreviewView, string> = {
  phone: 'Así lo verá el cliente',
  chat: 'Así queda en el chat del lead',
}

interface Props {
  form: TemplateFormState
  attachments: DraftAttachment[]
  mediaAssets: MediaAsset[]
  defaultFooter: string | undefined
  /** Con qué vista arranca: el editor mira el teléfono; la lista, el chat. */
  initialView?: PreviewView
}

/**
 * El mensaje como lo recibe el cliente, mientras se escribe (2026-11-23).
 * Antes se armaba a ciegas: `*negrita*` se veía con asteriscos y una oficial
 * se enviaba a Meta sin haber visto el resultado.
 *
 * Con «Chat del lead» (2026-11-24) se ve además como queda en la
 * conversación del CRM al mandarla: a la derecha, en verde y con los checks.
 */
export function TemplatePreview({ form, attachments, mediaAssets, defaultFooter, initialView = 'phone' }: Props) {
  const [withData, setWithData] = useState(true)
  const [view, setView] = useState<PreviewView>(initialView)
  const titleId = useId()
  const internal = form.templateType === 'internal'
  const preview = previewOf(form, { withData, defaultFooter })
  const files = internal && form.interactiveType === 'none' ? attachments : []
  // Con archivos, el texto viaja como pie de uno de ellos si cabe; si no,
  // sale en su propia burbuja.
  const withCaption = captionIndex(files, form.content)
  const headerAsset = mediaAssets.find(asset => asset.id === preview.headerImageAssetId)
  const headerUrl = headerAsset ? resolveMediaUrl(headerAsset.media_url) ?? null : null
  const showBubble = files.length === 0 || (preview.body.trim() !== '' && withCaption === null)

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold text-fg">{VIEW_TITLE[view]}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">{internal ? 'Con un cliente de ejemplo llamado Ana.' : 'Con los datos de ejemplo que revisa Meta.'}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Segmented label="Dónde se mira" options={VIEW_OPTIONS} value={view} onChange={setView} />
          {internal && <Segmented label="Datos de la vista previa" options={DATA_OPTIONS} value={withData} onChange={setWithData} />}
        </div>
      </div>

      {/* En el chat del lead lo enviado va a la derecha, en verde y con los
          checks, como cualquier mensaje del vendedor. */}
      <div className={cn('flex flex-col gap-1 bg-thread px-4 py-5 text-sm text-fg', view === 'chat' ? 'items-end' : 'items-start')}>
        {files.map((item, index) => <FileBubble key={item.key} item={item} view={view} caption={index === withCaption ? preview.body : null} />)}
        {showBubble && <MessageBubble preview={preview} headerUrl={headerUrl} view={view} />}
        {preview.buttons.map(button => <ButtonRow key={button.key} button={button} view={view} />)}
      </div>
    </section>
  )
}
