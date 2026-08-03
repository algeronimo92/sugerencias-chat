import { AUTOMATION_REACTION_EMOJIS } from '../domain/automationCatalog'

export function AutomationReactionPicker({
  emoji,
  onChange,
}: {
  emoji: string
  onChange: (emoji: string) => void
}) {
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Reacción a enviar" className="flex flex-wrap gap-1.5">
        {AUTOMATION_REACTION_EMOJIS.map(option => (
          <button
            key={option}
            type="button"
            aria-label={`Reaccionar con ${option}`}
            aria-pressed={emoji === option}
            onClick={() => onChange(option)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
              emoji === option
                ? 'border-violet-500 bg-violet-100 ring-2 ring-violet-500/20 dark:border-violet-400 dark:bg-violet-950/60'
                : 'border-wa-border bg-white hover:bg-wa-hover dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:bg-wa-hover-dark'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-[10px] text-wa-muted">
        Otro emoji
        <input
          value={emoji}
          maxLength={16}
          required
          onChange={event => onChange(event.target.value)}
          placeholder="Ej. ✨"
          className="w-full rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs text-wa-text outline-none focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
        />
      </label>
      <p className="text-[10px] text-wa-muted">
        Se aplicará al mensaje más reciente enviado por el cliente. Si ya reaccionaste, WhatsApp reemplazará esa reacción.
      </p>
    </div>
  )
}
