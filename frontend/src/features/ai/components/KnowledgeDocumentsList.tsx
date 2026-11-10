import { BookText, FileText } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import type { KnowledgeDocumentSummary } from '../types'

/** Una fila de la lista de documentos: título y a qué servicios sirve. Sin
 *  el conteo de "fragmentos": es cómo el motor parte el texto, no algo que la
 *  usuaria decida ni entienda. */
export function DocumentListItem({ document, serviceName, typeName, selected, onSelect }: {
  document: KnowledgeDocumentSummary
  serviceName: string
  typeName: string | undefined
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${selected ? 'bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-head-dark'}`}
      >
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{document.title}</span>
          <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
            {serviceName}
            {typeName ? ` · ${typeName}` : ''}
            {document.template_id != null ? ' · desde plantilla' : ''}
          </span>
        </span>
      </button>
    </li>
  )
}

export function DocumentsListStatus({ isLoading, error, empty, filterServiceId, onRetry }: {
  isLoading: boolean
  error: unknown
  empty: boolean
  filterServiceId: number | null
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <div className="mt-3 space-y-2" aria-label="Cargando documentos" role="status">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    )
  }
  if (error) {
    return (
      <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-red-600 dark:text-red-300">
        <span>No pudimos cargar los documentos. {extractErrorMessage(error)}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>Reintentar</Button>
      </div>
    )
  }
  if (!empty) return null
  return filterServiceId ? (
    <EmptyState
      icon={BookText}
      title="Este servicio no tiene documentos"
      description="Sube su ficha (PDF o texto) o importa una plantilla: el asistente la usará cuando un lead se interese en este servicio."
    />
  ) : (
    <EmptyState
      icon={BookText}
      title="Sin documentos"
      description="Carga fichas de servicios, políticas, preguntas frecuentes o guiones de venta, o importa una plantilla de la plataforma."
    />
  )
}
