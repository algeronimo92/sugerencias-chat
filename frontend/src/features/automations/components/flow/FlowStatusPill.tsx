import { flowStatus, type FlowStatusTone as Tone } from '../../domain/flowStatus'

/**
 * El estado del flujo en la cabecera del editor, siempre al día. Antes decía
 * "publicado v13" con los datos de cuando se abrió el editor: después de
 * publicar la v14 seguía igual, y nunca decía si había cambios sin publicar
 * ni si el flujo estaba pausado.
 */
export function FlowStatusPill({ publishedVersion, hasUnpublishedChanges, isActive }: {
  /** Versión publicada (null si nunca se publicó). */
  publishedVersion: number | null
  hasUnpublishedChanges: boolean
  isActive: boolean
}) {
  const { label, tone } = flowStatus(publishedVersion, hasUnpublishedChanges, isActive)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} aria-hidden="true" />
      {label}
    </span>
  )
}

const TONES: Record<Tone, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200',
  pending: 'bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
  paused: 'bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
  live: 'bg-green-50 text-green-800 dark:bg-green-950/60 dark:text-green-200',
}

const DOTS: Record<Tone, string> = {
  draft: 'bg-gray-400',
  pending: 'bg-blue-500',
  paused: 'bg-amber-500',
  live: 'bg-green-500',
}
