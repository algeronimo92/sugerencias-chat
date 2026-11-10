import { Select, fieldClass } from '../../../shared/ui/Input'
import { cn } from '../../../shared/utils/cn'
import { todayISODate } from '../../../shared/utils/datetime'
import { PERIODS, type PeriodKey, type SenderKey } from '../domain/executionHistoryFilters'

interface ExecutionHistoryFiltersProps {
  period: PeriodKey
  onPeriodChange: (next: PeriodKey) => void
  customFrom: string
  customTo: string
  onCustomFromChange: (value: string) => void
  onCustomToChange: (value: string) => void
  flows: readonly { id: number; name: string }[]
  ruleId: number | null
  onRuleChange: (ruleId: number | null) => void
  /** Las demás personas del equipo; null esconde "Enviado por", que solo
   *  tiene sentido para el admin. */
  senderOptions: readonly { id: number; name: string }[] | null
  sender: SenderKey
  onSenderChange: (sender: SenderKey) => void
}

/** Filtros de "Flujos enviados": período, flujo y, para el admin, quién envió. */
export function ExecutionHistoryFilters({
  period, onPeriodChange, customFrom, customTo, onCustomFromChange, onCustomToChange,
  flows, ruleId, onRuleChange, senderOptions, sender, onSenderChange,
}: ExecutionHistoryFiltersProps) {
  return (
    <section aria-label="Filtros del historial" className="mt-6 rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <p className="mb-2 text-sm font-semibold text-wa-text dark:text-wa-text-dark">Período</p>
          <div role="group" aria-label="Período del historial" className="inline-flex max-w-full rounded-lg border border-wa-border bg-wa-app p-1 dark:border-wa-border-dark dark:bg-wa-app-dark">
            {PERIODS.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => onPeriodChange(item.key)}
                aria-pressed={period === item.key}
                className={`min-h-10 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${
                  period === item.key
                    ? 'bg-white font-semibold text-wa-text shadow-sm dark:bg-wa-head-dark dark:text-wa-text-dark'
                    : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block min-w-0 flex-1 lg:max-w-xs">
          <span className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark">Flujo</span>
          <Select
            value={ruleId ?? ''}
            onChange={event => onRuleChange(event.target.value ? Number(event.target.value) : null)}
            className="min-h-10 w-full border-wa-border bg-white shadow-none dark:border-wa-border-dark dark:bg-wa-panel-dark"
          >
            <option value="">Todos los flujos</option>
            {flows.map(flow => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
          </Select>
        </label>

        {senderOptions && (
          <label className="block min-w-0 flex-1 lg:max-w-xs">
            <span className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark">Enviado por</span>
            <Select
              value={String(sender)}
              onChange={event => {
                const value = event.target.value
                onSenderChange(value === 'team' || value === 'me' ? value : Number(value))
              }}
              className="min-h-10 w-full border-wa-border bg-white shadow-none dark:border-wa-border-dark dark:bg-wa-panel-dark"
            >
              <option value="team">Todo el equipo</option>
              <option value="me">Yo</option>
              {senderOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        )}
      </div>

      {period === 'custom' && (
        <div className="mt-4 flex flex-col gap-3 border-t border-wa-border pt-4 sm:flex-row dark:border-wa-border-dark">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark sm:max-w-48">
            Desde
            <input type="date" value={customFrom} max={customTo} onChange={event => onCustomFromChange(event.target.value)} className={cn(fieldClass, 'min-h-10 w-full border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark')} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark sm:max-w-48">
            Hasta
            <input type="date" value={customTo} min={customFrom} max={todayISODate()} onChange={event => onCustomToChange(event.target.value)} className={cn(fieldClass, 'min-h-10 w-full border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark')} />
          </label>
        </div>
      )}
    </section>
  )
}
