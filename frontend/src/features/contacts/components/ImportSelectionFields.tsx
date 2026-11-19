import type { ReactNode } from 'react'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input, Select, labelClass } from '../../../shared/ui/Input'
import { cn } from '../../../shared/utils/cn'
import { contactsLabel, recentLabel, scopeCount, type ImportScope, type SelectionDraft } from '../domain/selection'
import type { ImportSummary } from '../types'
import { ImportRowsPicker } from './ImportRowsPicker'

function ScopeOption({ value, current, onSelect, title, count, disabled = false, children }: {
  value: ImportScope; current: ImportScope; onSelect: (value: ImportScope) => void
  title: string; count?: number; disabled?: boolean; children?: ReactNode
}) {
  const active = value === current
  // El detalle (periodo, lista) va fuera del <label>: adentro, cada clic en
  // la lista volvía a marcar la opción y los controles quedaban anidados.
  return (
    <div className={cn(
      'rounded-lg border p-3 text-sm',
      active ? 'border-wa-primary bg-wa-primary/5' : 'border-wa-border dark:border-wa-border-dark',
      disabled && 'opacity-50',
    )}>
      <label className={cn('flex items-center gap-2', !disabled && 'cursor-pointer')}>
        <input type="radio" name="import-scope" value={value} checked={active} disabled={disabled} onChange={() => onSelect(value)} className="accent-wa-primary" />
        <span className="flex-1 font-medium text-wa-text dark:text-wa-text-dark">{title}</span>
        {count !== undefined && <span className="text-xs text-wa-muted dark:text-wa-muted-dark">{contactsLabel(count)}</span>}
      </label>
      {active && children && <div className="mt-3">{children}</div>}
    </div>
  )
}

interface Props {
  batchId: string
  summary: ImportSummary
  draft: SelectionDraft
  patch: (values: Partial<SelectionDraft>) => void
}

/** Las opciones de cuántos importar (todos, recientes, uno por uno), el tope,
 *  las etiquetas y qué hacer con duplicados y con lo que no se elige. */
export function ImportSelectionFields({ batchId, summary, draft, patch }: Props) {
  const fromPhone = summary.source === 'whatsapp_app'
  const hasDates = summary.counts.with_interaction > 0
  return (
    <div className="space-y-4">
      <p className="text-sm text-wa-muted dark:text-wa-muted-dark">
        {contactsLabel(summary.counts.pending)} esperando
        {summary.counts.existing > 0 ? `, ${summary.counts.existing} ya están en la agenda` : ''}
        {summary.counts.invalid > 0 ? `, ${summary.counts.invalid} con datos que no se pueden importar` : ''}.
      </p>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Qué contactos importar</legend>
        <ScopeOption value="all" current={draft.scope} onSelect={scope => patch({ scope })} title="Todos" count={summary.counts.pending} />
        <ScopeOption
          value="recent" current={draft.scope} onSelect={scope => patch({ scope })}
          title="Solo los que conversaron hace poco" disabled={!hasDates}
          count={hasDates ? scopeCount(summary, { ...draft, scope: 'recent' }) : undefined}
        >
          <Select value={String(draft.days)} onChange={event => patch({ days: Number(event.target.value) })} aria-label="Periodo">
            {summary.recent.map(item => (
              <option key={item.days} value={item.days}>{recentLabel(item.days)} ({contactsLabel(item.count)})</option>
            ))}
          </Select>
        </ScopeOption>
        {!hasDates && (
          <p className="px-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            {fromPhone
              ? 'Las fechas de conversación llegan con el historial del celular; este número no lo compartió.'
              : 'Un CSV no trae fechas de conversación.'}
          </p>
        )}
        <ScopeOption value="manual" current={draft.scope} onSelect={scope => patch({ scope })} title="Elegir uno por uno" count={draft.scope === 'manual' ? draft.rowIds.length : undefined}>
          <ImportRowsPicker batchId={batchId} status="pending" selected={draft.rowIds} onChange={rowIds => patch({ rowIds })} />
        </ScopeOption>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Como máximo (opcional)</span>
          <Input type="number" min={1} inputMode="numeric" value={draft.limit} onChange={event => patch({ limit: event.target.value })} placeholder="Sin tope" />
          <span className="mt-1 block text-xs text-wa-muted dark:text-wa-muted-dark">Primero los de conversación más reciente.</span>
        </label>
        <label className="block">
          <span className={labelClass}>Etiquetas para todos (opcional)</span>
          <Input value={draft.tags} onChange={event => patch({ tags: event.target.value })} placeholder={fromPhone ? 'celular' : 'importado-noviembre'} />
        </label>
      </div>

      <div className="space-y-2 text-sm text-wa-text dark:text-wa-text-dark">
        <label className="flex items-start gap-2">
          <Checkbox checked={draft.fillEmpty} onCheckedChange={fillEmpty => patch({ fillEmpty })} className="mt-0.5" />
          <span>Completar los datos vacíos de quienes ya están en la agenda (nunca reemplaza lo que hay)</span>
        </label>
        <label className="flex items-start gap-2">
          <Checkbox checked={draft.close} onCheckedChange={close => patch({ close })} className="mt-0.5" />
          <span>Descartar lo que no elegí al terminar</span>
        </label>
      </div>

      {summary.counts.invalid > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-wa-muted dark:text-wa-muted-dark">Ver las {summary.counts.invalid} filas que no se pueden importar</summary>
          <div className="mt-2"><ImportRowsPicker batchId={batchId} status="invalid" /></div>
        </details>
      )}
    </div>
  )
}
