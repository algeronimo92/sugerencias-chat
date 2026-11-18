import { Loader2, Paperclip, PencilLine, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input, Textarea, labelClass } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useUpdateTemplate } from '../hooks/useTemplates'
import type { MessageTemplate } from '../types'
import { templateParameterIdentifiers } from '../utils/templates'
import { OfficialVariablesSection } from './OfficialVariablesSection'
import { TemplateVariableChips } from './TemplateVariableChips'

interface Props {
  template: MessageTemplate
  onClose: () => void
  onSaved?: (template: MessageTemplate) => void
  /** Oculta los datos de la cita al elegir las variables de una plantilla de
   *  Meta (desde una automatización, que no sabe de qué cita se trata). */
  leadOnlyVariables?: boolean
}

function resizeValues(content: string, current: string[]): string[] {
  return templateParameterIdentifiers(content).map((_, index) => current[index] ?? '')
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Editar el nombre, el texto y, en una de Meta, qué dato lleva cada variable,
 * sin salir del constructor de flujos. Adjuntos, botones, encabezado y pie se
 * siguen cambiando en Plantillas: acá solo va lo que se ajusta mientras se
 * arma un flujo, y el PATCH conserva lo demás.
 */
export function EditTemplateDialog({ template, onClose, onSaved, leadOnlyVariables = false }: Props) {
  const isMeta = template.template_type === 'official'
  const [name, setName] = useState(template.name)
  const [content, setContent] = useState(template.content)
  const [parameters, setParameters] = useState(template.official_parameter_values)
  const [error, setError] = useState<string | null>(null)
  const contentField = useRef<HTMLTextAreaElement>(null)
  const updateTemplate = useUpdateTemplate()

  const variables = isMeta ? templateParameterIdentifiers(content) : []
  const sizedParameters = isMeta ? resizeValues(content, parameters) : []
  const changesMessage = content.trim() !== template.content.trim() || !sameValues(sizedParameters, template.official_parameter_values)
  // Al guardar, el backend reenvía a Meta una plantilla ya enviada cuyo texto
  // o variables cambiaron: queda PENDING y no se puede mandar hasta que Meta
  // responda. Mejor que se sepa antes de tocar Guardar.
  const goesBackToReview = isMeta && Boolean(template.meta_template_id) && changesMessage
  const attachments = template.attachments?.length ?? 0

  function submit() {
    setError(null)
    const trimmedName = name.trim()
    const trimmedContent = content.trim()
    if (!trimmedName || !trimmedContent) {
      setError('Completa el nombre y el mensaje.')
      return
    }
    if (isMeta && sizedParameters.some(value => !value.trim())) {
      setError('Elige qué dato lleva cada variable.')
      return
    }
    updateTemplate.mutate(
      {
        id: template.id,
        name: trimmedName,
        content: trimmedContent,
        ...(isMeta ? { official_parameter_values: sizedParameters.map(value => value.trim()) } : {}),
      },
      {
        onSuccess: saved => { onSaved?.(saved); onClose() },
        onError: reason => setError(extractErrorMessage(reason)),
      },
    )
  }

  const pending = updateTemplate.isPending
  return (
    <Modal
      title="Editar plantilla"
      description={isMeta ? 'Plantilla de Meta. Los cambios se ven en todos los flujos que la usan.' : 'Los cambios se ven en todos los flujos que la usan.'}
      icon={<PencilLine className="h-4 w-4" />}
      size={isMeta ? 'md' : 'sm'}
      busy={pending}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {goesBackToReview ? 'Guardar y enviar a revisión' : 'Guardar cambios'}
        </Button>
      </>}
    >
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
        <div>
          <label htmlFor="edit-template-name" className={labelClass}>Nombre</label>
          <Input id="edit-template-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <label htmlFor="edit-template-content" className={labelClass}>Mensaje</label>
          <Textarea id="edit-template-content" ref={contentField} rows={5} value={content} onChange={event => setContent(event.target.value)} className="resize-y leading-relaxed" />
          <TemplateVariableChips field={contentField} value={content} onChange={setContent} meta={isMeta} />
        </div>
        {isMeta && variables.length > 0 && (
          <fieldset className="space-y-2">
            <legend className={labelClass}>Qué dato lleva cada variable</legend>
            <OfficialVariablesSection variables={variables} values={sizedParameters} onChange={setParameters} leadOnly={leadOnlyVariables} />
          </fieldset>
        )}
        {goesBackToReview && (
          <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Al guardar, Meta vuelve a revisar la plantilla. Hasta que la apruebe no se podrá enviar, ni desde el chat ni desde las automatizaciones.</span>
          </div>
        )}
        {(isMeta || attachments > 0) && (
          <p className="flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
            <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {isMeta
              ? 'Encabezado, pie y botones se cambian en Plantillas.'
              : `${plural(attachments, 'adjunto', 'adjuntos')} · se cambian en Plantillas.`}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}
