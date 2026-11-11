interface Option<Key extends string> {
  key: Key
  label: string
}

/** Alterna lecturas sobre el mismo gráfico. Son botones con `aria-pressed` y no
 *  pestañas: no cambian de panel, cambian qué cuenta el que ya se ve. */
export function ReadingToggle<Key extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Nombre accesible del grupo: qué se está eligiendo. */
  label: string
  options: Option<Key>[]
  value: Key
  onChange: (key: Key) => void
}) {
  return (
    <div role="group" aria-label={label} className="mb-3 inline-flex max-w-full flex-wrap rounded-lg border border-wa-border bg-wa-app p-1 dark:border-wa-border-dark dark:bg-wa-app-dark">
      {options.map(option => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
          className={`min-h-9 rounded-md px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${
            option.key === value
              ? 'bg-white font-semibold text-wa-text shadow-sm dark:bg-wa-head-dark dark:text-wa-text-dark'
              : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
