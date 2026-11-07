/**
 * Pestaña "Adjuntos" del asistente: qué archivos de la biblioteca puede
 * proponer y cuándo. La fila de cada archivo vive en ResourceCard.
 */
import { Check, FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMediaLibrary } from '../../media/public/queries'
import { isDescribed } from '../hooks/useDescriptionDraft'
import { ResourceCard } from './ResourceCard'
import { panelClass } from './styles'

type Filter = 'all' | 'pending' | 'visible'

const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Sin describir' },
  { key: 'visible', label: 'Visibles' },
]

const chipClass = (active: boolean) =>
  `inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${
    active
      ? 'border-wa-primary/40 bg-wa-primary/12 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary'
      : 'border-wa-border text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
  }`

function LoadingRows() {
  return (
    <ul aria-hidden="true" className="mt-2 divide-y divide-wa-border dark:divide-wa-border-dark">
      {[0, 1, 2].map(index => (
        <li key={index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 py-4">
          <Skeleton className="h-20 w-20 sm:row-span-2 sm:h-24 sm:w-32" />
          <Skeleton className="h-5 w-48 self-center sm:self-start" />
          <Skeleton className="col-span-2 h-16 sm:col-span-1" />
        </li>
      ))}
    </ul>
  )
}

export function AiResourcesPanel() {
  const { data: assets = [], isLoading, error, refetch } = useMediaLibrary()
  const [filter, setFilter] = useState<Filter>('all')

  // Lo recién subido es lo que falta describir, así que va primero. El orden
  // no depende de la descripción: una fila no salta de lugar al guardarla.
  const sorted = useMemo(() => [...assets].sort((a, b) => b.created_at.localeCompare(a.created_at)), [assets])
  const counts = {
    all: sorted.length,
    visible: sorted.filter(isDescribed).length,
    pending: sorted.filter(asset => !isDescribed(asset)).length,
  }
  const visibleRows = filter === 'all' ? sorted : sorted.filter(asset => (filter === 'visible') === isDescribed(asset))

  return (
    <div className={panelClass}>
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        Describe cuándo conviene enviar cada archivo. El asistente solo propone los que tienen descripción.
      </p>
      <p className="mt-1 text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">
        Di para quién sirve y en qué momento; una o dos frases bastan. Para subir archivos nuevos ve a{' '}
        <Link to="/media-library" className="font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary">Archivos</Link>.
      </p>

      {isLoading && <LoadingRows />}
      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-300">
          <span>No pudimos cargar la biblioteca. {extractErrorMessage(error)}</span>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>Reintentar</Button>
        </div>
      )}
      {!isLoading && !error && assets.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title="Aún no hay archivos"
          description="Sube flyers, catálogos o videos en Archivos y vuelve aquí para describirlos."
          action={<Button asChild><Link to="/media-library">Ir a Archivos</Link></Button>}
        />
      )}
      {assets.length > 0 && (
        <>
          <div role="group" aria-label="Filtrar archivos" className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-0.5">
            {FILTERS.map(item => (
              <button key={item.key} type="button" onClick={() => setFilter(item.key)} aria-pressed={filter === item.key} className={chipClass(filter === item.key)}>
                {item.label}
                <span className="tabular-nums opacity-80">{counts[item.key]}</span>
              </button>
            ))}
          </div>
          {visibleRows.length === 0 ? (
            <EmptyState
              icon={Check}
              title={filter === 'pending' ? 'Todo descrito' : 'Ningún archivo visible'}
              description={filter === 'pending'
                ? 'Todos los archivos tienen descripción. El asistente ya puede proponerlos.'
                : 'Escribe una descripción para que el asistente pueda proponer un archivo.'}
            />
          ) : (
            <ul className="mt-2 divide-y divide-wa-border dark:divide-wa-border-dark">
              {visibleRows.map(asset => <ResourceCard key={asset.id} asset={asset} />)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
