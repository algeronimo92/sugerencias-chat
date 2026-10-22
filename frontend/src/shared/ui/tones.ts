/** Tonos semánticos compartidos por los resúmenes de las bandejas (chips
 *  contador, íconos de fila, encabezados de grupo). Vive aparte del componente
 *  para que `StatChip.tsx` solo exporte componentes. */

export type StatTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning'

/** Fondo + texto del chip seleccionado. El color nunca viaja solo: cada chip
 *  lleva ícono, etiqueta y `aria-pressed`. */
export const STAT_TONE_SELECTED: Record<StatTone, string> = {
  neutral: 'border-wa-muted/50 bg-wa-field text-wa-text dark:border-wa-muted-dark/60 dark:bg-wa-active-dark dark:text-white',
  info: 'border-sky-600/40 bg-sky-50 text-sky-800 dark:border-wa-accent/50 dark:bg-wa-accent/10 dark:text-wa-accent',
  success: 'border-wa-primary/50 bg-wa-primary/10 text-wa-primary-strong dark:border-wa-primary/50 dark:bg-wa-primary/15 dark:text-wa-primary',
  danger: 'border-red-600/40 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300',
  warning: 'border-amber-600/40 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300',
}

/** Color del ícono por tono, también fuera del chip (filas, encabezados).
 *  Todos verificados a 4.5:1 o más sobre la superficie donde se usan. */
export const STAT_TONE_ICON: Record<StatTone, string> = {
  neutral: 'text-wa-muted dark:text-wa-muted-dark',
  info: 'text-sky-700 dark:text-wa-accent',
  success: 'text-wa-primary-strong dark:text-wa-primary',
  danger: 'text-red-700 dark:text-red-300',
  warning: 'text-amber-800 dark:text-amber-300',
}
