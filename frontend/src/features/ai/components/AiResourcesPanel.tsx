/**
 * Pestaña "Adjuntos" del asistente: qué archivos de la biblioteca puede
 * proponer y cuándo.
 *
 * La regla del backend es una sola: un archivo con descripción es visible
 * para el asistente; sin descripción, no existe para él. Por eso el estado se
 * muestra como etiqueta derivada del texto guardado y no como interruptor
 * aparte, que necesitaría un campo nuevo en la API.
 *
 * Se guarda al salir del campo (o con Ctrl/Cmd+Enter), con el resultado al
 * lado del campo y no en un toast: con treinta archivos, treinta botones
 * "Guardar" iguales y avisos lejos de lo que se editó cansaban más de lo que
 * ayudaban.
 */
import { Check, Eye, EyeOff, FolderOpen, Loader2, Pencil } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Textarea, labelClass } from '../../../shared/ui/Input'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { resolveMediaUrl } from '../../../shared/utils/mediaUrl'
import { MEDIA_KIND_LABELS, MediaAssetThumbnail, formatMediaSize, mediaAssetKind } from '../../media/public/MediaAssetThumbnail'
import { useMediaLibrary } from '../../media/public/queries'
import type { MediaAsset } from '../../media/types'
import { useSetAiResourceDescription } from '../queries'
import { panelClass } from './styles'

const MediaLightbox = lazy(() => import('../../../shared/ui/MediaLightbox').then(m => ({ default: m.MediaLightbox })))

// Mismo tope que valida el backend para ai_description.
const DESCRIPTION_MAX = 500
const COUNTER_FROM = 400

type Filter = 'all' | 'pending' | 'visible'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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

const isDescribed = (asset: MediaAsset) => Boolean(asset.ai_description?.trim())

function ResourceCard({ asset }: { asset: MediaAsset }) {
  const fieldId = useId()
  const saved = asset.ai_description ?? ''
  const [draft, setDraft] = useState(saved)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [previewOpen, setPreviewOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const thumbnailRef = useRef<HTMLButtonElement>(null)
  const save = useSetAiResourceDescription()
  const kind = mediaAssetKind(asset)
  const dirty = draft.trim() !== saved.trim()

  // Si otro usuario toca la biblioteca y la lista se refresca, no se pisa un
  // borrador que se está escribiendo; solo se alinea el campo en reposo.
  useEffect(() => {
    if (document.activeElement !== textareaRef.current) setDraft(saved)
  }, [saved])

  useEffect(() => {
    if (saveState !== 'saved') return
    const timer = window.setTimeout(() => setSaveState('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [saveState])

  function commit() {
    if (!dirty || save.isPending) return
    const description = draft.trim()
    setDraft(description)
    setSaveState('saving')
    save.mutate({ id: asset.id, description }, {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('error'),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }

  const status = dirty
    ? { variant: 'warning' as const, icon: Pencil, label: 'Sin guardar' }
    : isDescribed(asset)
      ? { variant: 'success' as const, icon: Eye, label: 'Visible para el asistente' }
      : { variant: 'neutral' as const, icon: EyeOff, label: 'Oculto para el asistente' }
  const StatusIcon = status.icon
  const canPreview = kind === 'image' || kind === 'video'

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-4 sm:gap-x-4">
      <MediaAssetThumbnail
        ref={thumbnailRef}
        asset={asset}
        onOpen={canPreview ? () => setPreviewOpen(true) : undefined}
        href={canPreview ? undefined : resolveMediaUrl(asset.media_url) ?? undefined}
        className="h-20 w-20 sm:row-span-2 sm:h-24 sm:w-32"
      />
      <div className="min-w-0 self-center sm:self-start">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={status.variant} size="md"><StatusIcon className="h-3 w-3" aria-hidden="true" />{status.label}</Badge>
          <span className="text-[11px] text-wa-muted dark:text-wa-muted-dark">{MEDIA_KIND_LABELS[kind]} · {formatMediaSize(asset.size_bytes)}</span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-wa-text dark:text-wa-text-dark" title={asset.filename}>{asset.filename}</p>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label htmlFor={fieldId} className={labelClass}>Cuándo enviarlo</label>
        <Textarea
          ref={textareaRef}
          id={fieldId}
          rows={2}
          value={draft}
          maxLength={DESCRIPTION_MAX}
          placeholder="Ej.: Promo de octubre de limpieza facial, para quien pregunta precios"
          onChange={event => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-describedby={`${fieldId}-status`}
          className="resize-y"
        />
        <div id={`${fieldId}-status`} aria-live="polite" className="mt-1 flex min-h-5 items-center justify-between gap-2 text-xs text-wa-muted dark:text-wa-muted-dark">
          <span className="flex items-center gap-1.5">
            {saveState === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Guardando…</>}
            {saveState === 'saved' && <><Check className="h-3.5 w-3.5 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />Guardado</>}
            {saveState === 'error' && (
              <span className="flex items-center gap-1.5 text-red-600 dark:text-red-300">
                No se guardó{save.error ? `: ${extractErrorMessage(save.error)}` : '.'}
                <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => { setSaveState('idle'); commit() }}>Reintentar</Button>
              </span>
            )}
          </span>
          {draft.length >= COUNTER_FROM && <span>{draft.length} / {DESCRIPTION_MAX}</span>}
        </div>
      </div>
      {previewOpen && (
        <Suspense fallback={null}>
          <MediaLightbox
            src={resolveMediaUrl(asset.media_url) ?? ''}
            kind={kind === 'video' ? 'video' : 'image'}
            alt={asset.filename}
            filename={asset.filename}
            onClose={() => { setPreviewOpen(false); thumbnailRef.current?.focus() }}
          />
        </Suspense>
      )}
    </li>
  )
}

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
