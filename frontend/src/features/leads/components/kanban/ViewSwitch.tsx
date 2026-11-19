import { Columns3, List } from 'lucide-react'
import type { KanbanView } from '../../hooks/useKanbanView'

const OPTIONS = [
  { value: 'tablero', label: 'Tablero', icon: Columns3 },
  { value: 'lista', label: 'Lista', icon: List },
] as const

export function ViewSwitch({ value, onChange }: { value: KanbanView; onChange: (view: KanbanView) => void }) {
  return (
    <div role="group" aria-label="Vista del embudo" className="inline-flex shrink-0 rounded-lg border border-wa-border bg-wa-field p-0.5 dark:border-wa-border-dark dark:bg-wa-field-dark">
      {OPTIONS.map(({ value: option, label, icon: Icon }) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(option)}
            className={`flex h-[30px] items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wa-primary-strong ${
              active
                ? 'bg-wa-panel text-wa-text shadow-sm dark:bg-wa-panel-dark dark:text-wa-text-dark'
                : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {/* En el celular solo el ícono: con el texto, el título se cortaba. */}
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
