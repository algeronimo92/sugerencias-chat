import { Plus } from 'lucide-react'
import type { RefObject } from 'react'
import { insertAtCursor, nextMetaVariable } from '../domain/variableInsertion'

const LEAD_VARIABLES = [
  { token: '{{nombre}}', label: 'Nombre' },
  { token: '{{telefono}}', label: 'Teléfono' },
  { token: '{{servicio}}', label: 'Servicio' },
  { token: '{{vendedor}}', label: 'Vendedor' },
  { token: '{{fecha_actual}}', label: 'Fecha de hoy' },
] as const

interface Props {
  field: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  /** Plantilla de Meta: sus variables son posicionales y el dato de cada
   *  una se elige aparte. */
  meta?: boolean
}

/**
 * Las variables como fichas que se insertan con un clic (2026-11-18). Antes
 * había una línea «Variables: {{nombre}}, {{telefono}}…» para copiar a mano,
 * y un error de tipeo (`{{nombres}}`) dejaba la plantilla sin guardar.
 */
export function TemplateVariableChips({ field, value, onChange, meta = false }: Props) {
  const tokens = meta ? [{ token: nextMetaVariable(value), label: 'Variable' }] : LEAD_VARIABLES

  function insert(token: string) {
    const next = insertAtCursor(field.current, value, token)
    onChange(next.value)
    requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Insertar variable">
      {tokens.map(({ token, label }) => (
        <button
          key={label}
          type="button"
          onClick={() => insert(token)}
          title={`Insertar ${token}`}
          className="inline-flex items-center gap-1 rounded-full border border-wa-border px-2.5 py-1 text-xs font-medium text-wa-text outline-none transition-colors hover:border-wa-primary/50 hover:bg-wa-primary/5 focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:border-wa-border-dark dark:text-wa-text-dark"
        >
          <Plus className="h-3 w-3 text-wa-muted" aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  )
}
