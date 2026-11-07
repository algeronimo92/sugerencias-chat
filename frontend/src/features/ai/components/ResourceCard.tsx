/**
 * Una fila de la pestaña "Adjuntos": miniatura, estado y el campo "Cuándo
 * enviarlo". Imagen y video se abren en el visor; un audio se escucha aquí
 * mismo, para describirlo mientras suena; un documento se abre en otra
 * pestaña.
 *
 * La regla del backend es una sola: un archivo con descripción es visible
 * para el asistente; sin descripción, no existe para él. Por eso el estado se
 * muestra como etiqueta derivada del texto guardado y no como interruptor
 * aparte, que necesitaría un campo nuevo en la API.
 */
import { AlertCircle, Check, Eye, EyeOff, Loader2, Pencil } from 'lucide-react'
import { lazy, Suspense, useId, useRef, useState } from 'react'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { Textarea, labelClass } from '../../../shared/ui/Input'
import { AudioPlayer } from '../../../shared/ui/MediaPlayer'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { resolveMediaUrl } from '../../../shared/utils/mediaUrl'
import { MEDIA_KIND_LABELS, MediaAssetThumbnail, formatMediaSize, mediaAssetKind } from '../../media/public/MediaAssetThumbnail'
import type { MediaAsset, MediaAssetKind } from '../../media/types'
import { isDescribed, useDescriptionDraft } from '../hooks/useDescriptionDraft'

const MediaLightbox = lazy(() => import('../../../shared/ui/MediaLightbox').then(m => ({ default: m.MediaLightbox })))

// Mismo tope que valida el backend para ai_description.
const DESCRIPTION_MAX = 500
const COUNTER_FROM = 400

// Dicen qué hacer o qué se gana, no cómo funciona el sistema: "Falta
// describirlo" es la tarea, "La IA puede sugerirlo" el resultado.
const STATUS = {
  dirty: { variant: 'warning', icon: Pencil, label: 'Sin guardar' },
  visible: { variant: 'success', icon: Eye, label: 'La IA puede sugerirlo' },
  hidden: { variant: 'neutral', icon: EyeOff, label: 'Falta describirlo' },
} as const

function ResourceHeader({ asset, kind, dirty }: { asset: MediaAsset; kind: MediaAssetKind; dirty: boolean }) {
  const status = dirty ? STATUS.dirty : isDescribed(asset) ? STATUS.visible : STATUS.hidden
  const StatusIcon = status.icon
  return (
    <div className="min-w-0 self-start">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant={status.variant} size="md"><StatusIcon className="h-3 w-3" aria-hidden="true" />{status.label}</Badge>
        <span className="text-[11px] text-wa-muted dark:text-wa-muted-dark">{MEDIA_KIND_LABELS[kind]} · {formatMediaSize(asset.size_bytes)}</span>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-wa-text dark:text-wa-text-dark" title={asset.filename}>{asset.filename}</p>
    </div>
  )
}

/** Un audio se escucha en la fila; si no carga, se dice y se puede reintentar. */
function ResourceAudio({ asset }: { asset: MediaAsset }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const url = resolveMediaUrl(asset.media_url) ?? ''
  if (failed) {
    return (
      <div role="alert" className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-red-600 dark:text-red-300 sm:col-span-1">
        <span className="flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />No se pudo cargar el audio. Revisa tu conexión o vuelve a subir el archivo.</span>
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>Reintentar</Button>
      </div>
    )
  }
  return (
    <AudioPlayer
      key={attempt}
      src={url}
      className="col-span-2 w-full max-w-md sm:col-span-1"
      ariaLabel={`Audio ${asset.filename}`}
      downloadName={asset.filename}
      onError={() => setFailed(true)}
    />
  )
}

function SaveStatus({ state, error, onRetry }: { state: DraftState['saveState']; error: unknown; onRetry: () => void }) {
  if (state === 'saving') return <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Guardando…</>
  if (state === 'saved') return <><Check className="h-3.5 w-3.5 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />Guardado</>
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-red-600 dark:text-red-300">
        No se guardó{error ? `: ${extractErrorMessage(error)}` : '.'}
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onRetry}>Reintentar</Button>
      </span>
    )
  }
  return null
}

type DraftState = ReturnType<typeof useDescriptionDraft>

function DescriptionField({ draft, setDraft, saveState, error, textareaRef, commit, onKeyDown, retry }: DraftState) {
  const fieldId = useId()
  return (
    <div className="col-span-2 sm:col-span-1">
      <label htmlFor={fieldId} className={labelClass}>Cuándo enviarlo</label>
      <Textarea
        ref={textareaRef}
        id={fieldId}
        rows={3}
        value={draft}
        maxLength={DESCRIPTION_MAX}
        placeholder="Ej.: Cuando pregunten precios de limpieza facial, enviar la promo de octubre"
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-describedby={`${fieldId}-status`}
        className="resize-y"
      />
      <div id={`${fieldId}-status`} aria-live="polite" className="mt-1 flex min-h-5 items-center justify-between gap-2 text-xs text-wa-muted dark:text-wa-muted-dark">
        <span className="flex items-center gap-1.5"><SaveStatus state={saveState} error={error} onRetry={retry} /></span>
        {draft.length >= COUNTER_FROM && <span>{draft.length} / {DESCRIPTION_MAX}</span>}
      </div>
    </div>
  )
}

export function ResourceCard({ asset }: { asset: MediaAsset }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const thumbnailRef = useRef<HTMLButtonElement>(null)
  const draftState = useDescriptionDraft(asset)
  const kind = mediaAssetKind(asset)
  const canPreview = kind === 'image' || kind === 'video'
  const url = resolveMediaUrl(asset.media_url) ?? ''

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-4 sm:gap-x-5 sm:py-5">
      <MediaAssetThumbnail
        ref={thumbnailRef}
        asset={asset}
        onOpen={canPreview ? () => setPreviewOpen(true) : undefined}
        href={kind === 'document' ? url : undefined}
        // Abarca las tres filas de texto (en audio, también el reproductor):
        // así queda anclada arriba, como el avatar en WhatsApp, sin flotar.
        className="h-20 w-20 self-start sm:row-span-3 sm:h-28 sm:w-40"
      />
      <ResourceHeader asset={asset} kind={kind} dirty={draftState.dirty} />
      {kind === 'audio' && <ResourceAudio asset={asset} />}
      <DescriptionField {...draftState} />
      {previewOpen && (
        <Suspense fallback={null}>
          <MediaLightbox
            src={url}
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
