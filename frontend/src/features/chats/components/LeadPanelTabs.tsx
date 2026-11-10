import { Sparkles, UserRound } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { PanelTab } from '../hooks/useLeadPanelTab'
import { Button } from '../../../shared/ui/Button'

const TABS: { id: PanelTab; label: string; icon: typeof UserRound }[] = [
  { id: 'ficha', label: 'Ficha', icon: UserRound },
  { id: 'copiloto', label: 'Copiloto IA', icon: Sparkles },
]

/** Pestañas "Ficha" y "Copiloto IA" del panel del lead, con el botón para
 *  pedir otras sugerencias cuando el copiloto está a la vista. */
export function LeadPanelTabs({ tab, onChange, canRegenerate, isGenerating, onRegenerate }: {
  tab: PanelTab
  onChange: (tab: PanelTab) => void
  canRegenerate: boolean
  isGenerating: boolean
  onRegenerate: () => void
}) {
  // Flechas izquierda/derecha entre pestañas, como pide el patrón ARIA.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'ficha' ? 'copiloto' : 'ficha'
    onChange(next)
    document.getElementById(`tab-lead-${next}`)?.focus()
  }
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-wa-border px-2 dark:border-wa-border-dark">
      <div role="tablist" aria-label="Panel del lead" className="flex h-full items-end gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`tab-lead-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`panel-lead-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={onKeyDown}
            className={`flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-xs font-semibold transition-colors ${
              tab === id
                ? 'border-wa-primary text-wa-text dark:text-white'
                : 'border-transparent text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${id === 'copiloto' ? 'text-violet-600 dark:text-violet-300' : ''}`} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {/* "Otras" solo tiene sentido con sugerencias ya generadas. */}
      {canRegenerate && (
        <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={isGenerating} title="Generar un juego nuevo de sugerencias" className="ml-auto">
          <Sparkles className={`h-3.5 w-3.5 ${isGenerating ? 'animate-pulse text-wa-primary' : ''}`} aria-hidden="true" />
          Genera otras
        </Button>
      )}
    </div>
  )
}
