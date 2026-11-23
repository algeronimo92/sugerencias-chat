import { CornerUpLeft, ExternalLink, FileText, Image as ImageIcon, List, Phone } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../../../shared/utils/cn'
import type { MediaAsset } from '../../../media/types'
import { parseRichText, resolveMediaUrl } from '../../../whatsapp/public/message'
import { captionIndex, draftContentType, draftFilename, type DraftAttachment } from '../../domain/attachmentDraft'
import { previewOf, type PreviewButton } from '../../domain/templatePreview'
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
  return <>{parseRichText(text).map((segment, index) => <span key={index} className={SEGMENT_CLASS[segment.type]}>{segment.text}</span>)}</>
}

function imageUrlOf(item: DraftAttachment): string | null {
  if (!draftContentType(item).startsWith('image/')) return null
  const url = item.source === 'saved' ? item.attachment.media_url : item.source === 'library' ? item.asset.media_url : null
  return url ? resolveMediaUrl(url) ?? null : null
}

function ButtonRow({ button }: { button: PreviewButton }) {
  const Icon = BUTTON_ICON[button.kind]
  return (
    <div className="flex max-w-[19rem] items-center justify-center gap-2 rounded-lg bg-bubble-in px-3 py-2.5 text-sm font-medium text-info-fg shadow-sm">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{button.text}</span>
    </div>
  )
}

interface Props {
  form: TemplateFormState
  attachments: DraftAttachment[]
  mediaAssets: MediaAsset[]
  defaultFooter: string | undefined
}

/**
 * El mensaje como lo recibe el cliente, mientras se escribe (2026-11-23).
 * Antes se armaba a ciegas: `*negrita*` se veía con asteriscos y una oficial
 * se enviaba a Meta sin haber visto el resultado.
 */
export function TemplatePreview({ form, attachments, mediaAssets, defaultFooter }: Props) {
  const [withData, setWithData] = useState(true)
  const internal = form.templateType === 'internal'
  const preview = previewOf(form, { withData, defaultFooter })
  const carriesFiles = internal && form.interactiveType === 'none'
  const files = carriesFiles ? attachments : []
  const withCaption = captionIndex(files, form.content)
  const headerAsset = mediaAssets.find(asset => asset.id === preview.headerImageAssetId)
  const headerUrl = headerAsset ? resolveMediaUrl(headerAsset.media_url) : null
  const hasText = preview.body.trim() !== ''
  const textApart = hasText && withCaption === null

  return (
    <section aria-labelledby="template-preview-title" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 id="template-preview-title" className="text-base font-semibold text-fg">Así lo verá el cliente</h2>
        <p className="mt-0.5 text-sm text-fg-muted">{internal ? 'Con un cliente de ejemplo llamado Ana.' : 'Con los datos de ejemplo que revisa Meta.'}</p>
        {internal && (
          <div role="group" aria-label="Datos de la vista previa" className="mt-2.5 inline-flex gap-1 rounded-lg bg-subtle p-1">
            {([[true, 'Con datos'], [false, 'Sin datos']] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={withData === value}
                onClick={() => setWithData(value)}
                className={cn(
                  'h-8 rounded-md px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  withData === value ? 'bg-surface font-semibold text-fg shadow-sm' : 'font-medium text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 bg-thread px-4 py-5 text-sm text-fg">
        {files.map((item, index) => {
          const url = imageUrlOf(item)
          const caption = index === withCaption
          return (
            <div key={item.key} className="max-w-[19rem] rounded-lg bg-bubble-in p-1 shadow-sm">
              {url
                ? <img src={url} alt="" className="max-h-48 w-full rounded-md object-cover" />
                : (
                  <div className="flex items-center gap-2 rounded-md bg-subtle px-3 py-3 text-fg-muted">
                    {draftContentType(item).startsWith('image/') ? <ImageIcon className="h-4 w-4 shrink-0" aria-hidden="true" /> : <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span className="truncate text-xs">{draftFilename(item)}</span>
                  </div>
                )}
              {caption && <p className="whitespace-pre-wrap break-words px-1.5 pb-1 pt-1.5"><RichText text={preview.body} /></p>}
            </div>
          )
        })}

        {(files.length === 0 || textApart || preview.header || headerUrl) && (
          <div className="max-w-[19rem] rounded-lg bg-bubble-in px-2.5 pb-1.5 pt-2 shadow-sm">
            {headerUrl && <img src={headerUrl} alt="" className="mb-1.5 max-h-48 w-full rounded-md object-cover" />}
            {preview.headerImageAssetId != null && !headerUrl && (
              <div className="mb-1.5 flex items-center gap-2 rounded-md bg-subtle px-3 py-3 text-xs text-fg-muted"><ImageIcon className="h-4 w-4" aria-hidden="true" />Imagen del encabezado</div>
            )}
            {preview.header && <p className="mb-1 break-words font-semibold">{preview.header}</p>}
            {hasText
              ? <p className="whitespace-pre-wrap break-words"><RichText text={preview.body} /></p>
              : <p className="text-fg-muted">Aquí aparecerá tu mensaje.</p>}
            {preview.footer && <p className="mt-1.5 break-words text-xs text-bubble-meta">{preview.footer}</p>}
            <p className="mt-0.5 text-right text-xs text-bubble-meta" aria-hidden="true">10:24</p>
          </div>
        )}

        {preview.buttons.map((button, index) => <ButtonRow key={`${button.kind}-${index}`} button={button} />)}
      </div>
    </section>
  )
}
