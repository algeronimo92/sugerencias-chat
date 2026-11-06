/** Clases que comparten las pestañas del asistente y sus paneles. */

export const tabClass = (active: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-wa-primary/60 sm:min-h-9 ${
    active
      ? 'bg-wa-primary/12 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary'
      : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
  }`

export const panelClass = 'rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark'
