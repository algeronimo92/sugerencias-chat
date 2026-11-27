import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Checkbox } from '../../../../shared/ui/Checkbox'
import type { MessageTemplate } from '../../../templates/types'
import { NO_REPLY_HELP } from '../../domain/automationCatalog'
import { newTemplateReply, replyIsOutdated, templateQuickReplies } from '../../domain/templateReply'
import type { TemplateReply } from '../../types'

/**
 * «Seguir según el botón que toque», en el paso Enviar plantilla (2026-11-27).
 *
 * Solo aparece si la plantilla elegida es de Meta y tiene botones de respuesta
 * rápida. Apagado, el paso sigue por «Siguiente» como siempre: las
 * automatizaciones que ya mandaban plantillas con botones no cambian.
 */
export function TemplateReplyField({ template, reply, onChange, children }: {
  template: MessageTemplate | null
  reply: TemplateReply | undefined
  onChange: (reply: TemplateReply | undefined) => void
  /** El campo del tiempo máximo, que dibuja el editor. */
  children?: ReactNode
}) {
  const labels = templateQuickReplies(template)
  if (labels.length === 0 && !reply) return null
  const outdated = reply != null && template != null && replyIsOutdated(reply, labels)
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 rounded-xl border border-wa-border bg-wa-hover p-3 text-[10px] text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-200">
        <Checkbox
          checked={reply != null}
          onChange={event => onChange(event.target.checked ? newTemplateReply(labels) : undefined)}
        />
        <span>
          <strong className="block text-xs">Seguir según el botón que toque</strong>
          <span className="mt-0.5 block text-wa-muted dark:text-wa-muted-dark">
            {reply
              ? 'El paso espera la respuesta del cliente. Conecta cada botón, «Otra respuesta» y «Sin respuesta». «Otra respuesta» es cuando escribe en vez de tocar un botón.'
              : `Una ruta distinta para ${labels.map(label => `«${label}»`).join(', ')}. Apagado, sigue por «Siguiente» sin esperar.`}
          </span>
        </span>
      </label>
      {outdated && (
        <div role="alert" className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p>
            {labels.length > 0
              ? 'Los botones de la plantilla cambiaron y las salidas de este paso ya no coinciden. Así no se puede publicar.'
              : 'Esta plantilla ya no tiene botones de respuesta rápida. Apaga el ajuste o elige otra plantilla.'}
          </p>
          {labels.length > 0 && (
            <button type="button" onClick={() => onChange(newTemplateReply(labels, reply.timeout_seconds))} className="flex items-center gap-1 font-semibold underline">
              <RefreshCw className="h-3 w-3" aria-hidden="true" />Actualizar botones
            </button>
          )}
        </div>
      )}
      {reply && (
        <div>
          <p className="mb-1 text-[10px] font-semibold text-wa-muted">Tiempo máximo para responder</p>
          {children}
          <p className="mt-1 text-[10px] text-wa-muted dark:text-wa-muted-dark">{NO_REPLY_HELP}</p>
        </div>
      )}
    </div>
  )
}
