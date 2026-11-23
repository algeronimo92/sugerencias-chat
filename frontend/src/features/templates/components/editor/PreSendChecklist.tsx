import { Check, TriangleAlert } from 'lucide-react'
import type { PreSendCheck } from '../../domain/preSendChecks'

/**
 * Lo que Meta suele rechazar, revisado mientras se escribe. Son avisos: no
 * impiden enviar, porque Meta también revisa el contenido y eso no se puede
 * anticipar acá.
 */
export function PreSendChecklist({ checks }: { checks: PreSendCheck[] }) {
  const pending = checks.filter(check => !check.ok).length
  return (
    <section aria-labelledby="pre-send-title" className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <h2 id="pre-send-title" className="text-sm font-semibold text-fg">Antes de enviarla</h2>
      <p className="mt-0.5 text-xs text-fg-muted">
        {pending === 0 ? 'Cumple con lo que Meta suele rechazar por formato.' : `Meta suele rechazar por esto. ${pending === 1 ? 'Queda 1 punto' : `Quedan ${pending} puntos`} por revisar.`}
      </p>
      <ul className="mt-2.5 flex flex-col gap-2">
        {checks.map(check => (
          <li key={check.id} className="flex items-start gap-2 text-sm">
            {check.ok
              ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" strokeWidth={2.5} aria-hidden="true" />
              : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden="true" />}
            <span className="min-w-0">
              <span className={check.ok ? 'text-fg' : 'font-medium text-fg'}>
                <span className="sr-only">{check.ok ? 'Cumple: ' : 'Por revisar: '}</span>{check.label}
              </span>
              {!check.ok && <span className="mt-0.5 block text-xs text-fg-muted">{check.fix}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
