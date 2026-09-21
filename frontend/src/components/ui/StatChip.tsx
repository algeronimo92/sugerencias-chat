import type { LucideIcon } from 'lucide-react'
import { cn } from '../../utils/cn'
import { Skeleton } from './Skeleton'
import { STAT_TONE_ICON, STAT_TONE_SELECTED, type StatTone } from './tones'

interface Props {
  icon: LucideIcon
  label: string
  count: number
  tone: StatTone
  selected: boolean
  loading?: boolean
  /** Presentación de una línea para filtros de listas. */
  compact?: boolean
  /** Qué responde este grupo, en una línea, para el tooltip nativo. */
  hint?: string
  onSelect: () => void
  className?: string
}

/** KPI y filtro en el mismo control: el número deja de ser decorativo y pasa a
 *  ser la forma de llegar a esos registros (un clic en vez de dos controles
 *  distintos que decían lo mismo). */
export function StatChip({ icon: Icon, label, count, tone, selected, loading = false, compact = false, hint, onSelect, className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={hint}
      className={cn(
        compact
          ? 'inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors duration-150'
          : 'flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-wa-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-wa-app dark:focus-visible:ring-offset-wa-app-dark',
        selected
          ? STAT_TONE_SELECTED[tone]
          : 'border-wa-border bg-white text-wa-text hover:border-wa-muted/40 hover:bg-wa-hover dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark dark:hover:bg-wa-head-dark',
        className,
      )}
    >
      <span
        className={cn(
          compact ? 'grid h-5 w-5 shrink-0 place-items-center' : 'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
          !compact && (selected ? 'bg-white/70 dark:bg-black/20' : 'bg-wa-field dark:bg-wa-field-dark'),
          STAT_TONE_ICON[tone],
        )}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className={cn('min-w-0', compact && 'flex items-center gap-2')}>
        <span className={cn('block truncate font-medium', compact ? 'text-sm text-current' : 'text-xs text-wa-muted dark:text-wa-muted-dark')}>{label}</span>
        {loading
          ? <Skeleton as="span" className={cn('block bg-black/10 dark:bg-white/10', compact ? 'h-4 w-5' : 'mt-1 h-6 w-8')} />
          : <span className={cn('block tabular-nums', compact ? 'text-sm font-semibold' : 'text-xl leading-7', selected && 'font-bold')}>{count}</span>}
      </span>
    </button>
  )
}
