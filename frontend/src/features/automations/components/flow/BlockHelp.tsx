import { CircleHelp } from 'lucide-react'

/** El botón «?» de la cabecera de un bloque. Abre la explicación debajo, en
 *  el mismo panel: un tooltip no se puede leer con calma ni en el celular. */
export function BlockHelpToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? 'Ocultar cómo funciona' : 'Cómo funciona este bloque'}
      title={open ? 'Ocultar cómo funciona' : 'Cómo funciona este bloque'}
      className={`flex shrink-0 items-center justify-center rounded-lg border p-1.5 transition-colors ${open
        ? 'border-wa-primary bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary'
        : 'border-wa-border text-gray-600 hover:bg-wa-hover dark:border-wa-border-dark dark:text-gray-300 dark:hover:bg-wa-head-dark'}`}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

export function BlockHelpPanel({ id, lines }: { id: string; lines: string[] }) {
  return (
    <ul id={id} className="mb-4 space-y-1 rounded-lg bg-wa-hover p-2.5 text-[11px] leading-relaxed text-gray-700 dark:bg-wa-head-dark dark:text-gray-200">
      {lines.map(line => <li key={line} className="flex gap-1.5"><span aria-hidden="true" className="text-wa-muted">·</span><span>{line}</span></li>)}
    </ul>
  )
}
