import { Check, CheckCheck, Clock3, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useExecutionMessages } from '../queries'

// Las mismas marcas que WhatsApp, que el equipo ya sabe leer: un visto es
// enviado, dos es entregado y dos en azul es leído.
const MARKS: Record<string, { icon: LucideIcon; label: string; tone: string }> = {
  pending: { icon: Clock3, label: 'En cola', tone: 'text-fg-muted' },
  sent: { icon: Check, label: 'Enviado', tone: 'text-fg-muted' },
  delivered: { icon: CheckCheck, label: 'Entregado', tone: 'text-fg-muted' },
  read: { icon: CheckCheck, label: 'Leído', tone: 'text-sky-600 dark:text-sky-400' },
  failed: { icon: X, label: 'No se entregó', tone: 'text-danger-fg' },
}

interface Props {
  executionId: number
  /** Los mensajes de este paso (`message_ids` de su resultado). */
  messageIds: number[]
  /** Solo se consulta con el detalle abierto. */
  enabled: boolean
}

/**
 * Qué pasó con los mensajes de un paso: en cola, enviado, entregado, leído o
 * no entregado. El paso decía «Hecho» en cuanto encolaba, hubiera salido o no.
 *
 * «Sin leer» no se marca como problema: el cliente puede tener apagada la
 * confirmación de lectura.
 */
export function MessageMarks({ executionId, messageIds, enabled }: Props) {
  const { data } = useExecutionMessages(executionId, enabled && messageIds.length > 0)
  if (!data) return null
  const states = messageIds.map(id => data.find(message => message.message_id === id)?.state).filter((state): state is string => !!state)
  if (states.length === 0) return null
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 align-middle">
      {states.map((state, index) => {
        const mark = MARKS[state]
        if (!mark) return null
        const Icon = mark.icon
        return (
          <span key={index} className={`inline-flex items-center gap-1 ${mark.tone}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {mark.label}
          </span>
        )
      })}
    </span>
  )
}
