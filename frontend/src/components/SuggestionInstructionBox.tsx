import { useId, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from './ui/Button'
import { pillFieldClass } from './ui/Input'

/** Tope alineado con el backend (SuggestionRequest.instruction). */
export const INSTRUCTION_MAX_LENGTH = 200

/**
 * Indicaciones frecuentes: un toque y listo, sin abrir el teclado — clave
 * para usar con una mano en móvil. Tocar de nuevo el chip la quita.
 */
const QUICK_CHIPS = ['Dar precio', 'No dar precio', 'Proponer una cita']

const CHIP_ACTIVE_CLASS =
  'border-wa-primary/40 bg-wa-primary/10 text-wa-primary-strong dark:border-wa-primary/40 dark:bg-wa-primary/15 dark:text-wa-primary'
const CHIP_IDLE_CLASS =
  'border-wa-border text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark'

interface Props {
  value: string
  onChange: (value: string) => void
  /** Deshabilita chips e input mientras se está generando. */
  disabled?: boolean
  className?: string
}

/**
 * Indicación opcional del asesor para orientar a la IA al generar sugerencias
 * ("dar precio", "no dar precio", contexto del cliente…). Arranca colapsada
 * para no ensuciar el panel: si no se usa, el flujo queda igual que siempre.
 * Con texto cargado queda siempre abierta — lo que se va a aplicar se ve,
 * nada actúa a escondidas.
 */
export function SuggestionInstructionBox({ value, onChange, disabled = false, className = '' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const inputId = useId()
  const trimmed = value.trim()
  const hasValue = trimmed.length > 0

  if (!isOpen && !hasValue) {
    return (
      <div className={className}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setIsOpen(true)}
          disabled={disabled}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          Orientá a la IA (opcional)
        </Button>
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border border-wa-border dark:border-wa-border-dark bg-white dark:bg-wa-head-dark p-3 space-y-2.5 text-left ${className}`}
    >
      <div className="flex items-center gap-1.5">
        <label
          htmlFor={inputId}
          className="text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark"
        >
          Indicación para la IA
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto -my-1 -mr-1"
          onClick={() => {
            onChange('')
            setIsOpen(false)
          }}
          disabled={disabled}
        >
          {hasValue ? 'Quitar' : 'Ocultar'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_CHIPS.map((chip) => {
          const isActive = trimmed === chip
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={isActive}
              disabled={disabled}
              onClick={() => onChange(isActive ? '' : chip)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive ? CHIP_ACTIVE_CLASS : CHIP_IDLE_CLASS
              }`}
            >
              {chip}
            </button>
          )
        })}
      </div>

      <input
        id={inputId}
        type="text"
        value={value}
        maxLength={INSTRUCTION_MAX_LENGTH}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Indicación libre… ej.: le interesa Hollywood peel"
        className={pillFieldClass}
      />

      <p className="text-[11px] text-wa-muted/80 dark:text-wa-muted-dark/80">
        Se aplica la próxima vez que generes sugerencias.
      </p>
    </div>
  )
}
