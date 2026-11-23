import type { MessageTemplate } from '../../types'
import { ChoiceCard, EditorSection } from './parts'

type TemplateType = MessageTemplate['template_type']

interface Props {
  type: TemplateType
  /** Ya existe: el tipo se muestra, pero no se cambia. */
  locked: boolean
  onChange: (type: TemplateType) => void
}

/**
 * Para qué sirve la plantilla. Se elige por el uso («responder en un chat
 * abierto» o «escribir primero») en vez de pedir que se sepa la diferencia
 * entre interna y oficial; el nombre técnico va en la explicación.
 */
export function TemplateTypeSection({ type, locked, onChange }: Props) {
  const official = type === 'official'
  if (locked) {
    return (
      <section className="rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5">
        <h2 className="text-base font-semibold text-fg">{official ? 'Plantilla oficial de Meta' : 'Plantilla interna'}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          {official
            ? 'Sirve para escribir primero o después de 24 horas sin respuesta.'
            : 'Se envía al instante en chats donde el cliente escribió en las últimas 24 horas.'}{' '}
          El tipo no se cambia después de crearla.
        </p>
      </section>
    )
  }
  return (
    <EditorSection title="¿Para qué la vas a usar?">
      <div className="grid gap-2 sm:grid-cols-2">
        <ChoiceCard
          name="template-type"
          title="Responder en un chat abierto"
          description="Plantilla interna. Se envía al instante, sin aprobación, si el cliente escribió en las últimas 24 horas."
          checked={!official}
          onSelect={() => onChange('internal')}
        />
        <ChoiceCard
          name="template-type"
          title="Escribir primero o después de 24 horas"
          description="Plantilla oficial. Meta la revisa antes de que puedas enviarla."
          checked={official}
          onSelect={() => onChange('official')}
        />
      </div>
    </EditorSection>
  )
}
