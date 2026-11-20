import { PanelLeftClose } from 'lucide-react'
import { Tooltip } from '../../../../shared/ui/Tooltip'
import type { ChatFiltersState } from '../../layoutContext'
import { InboxSections } from './InboxSections'

interface Props {
  filters: ChatFiltersState
  onCollapse: () => void
}

/**
 * Panel de bandejas a la izquierda de la lista de chats, como el de Manychat
 * (doc 18 §5.2 y §6.3): quién atiende, qué necesita atención y en qué etapa
 * está cada chat, con cuántos hay en cada uno. Reemplaza en escritorio a los
 * chips de vistas rápidas de la lista. En el celular, las mismas secciones
 * van en una hoja inferior (InboxSheet).
 */
export function InboxPanel({ filters, onCollapse }: Props) {
  return (
    <nav aria-label="Bandejas" className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
        <h2 className="text-base font-semibold text-fg">Bandejas</h2>
        <Tooltip content="Ocultar bandejas" side="right">
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Ocultar bandejas"
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelLeftClose className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <InboxSections filters={filters} />
      </div>
    </nav>
  )
}
