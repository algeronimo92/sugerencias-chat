import { AlarmClock, Check, Loader2, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { IntegrationCard, IntegrationDisclosure, type IntegrationState } from '../../../shared/ui/IntegrationCard'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { cn } from '../../../shared/utils/cn'
import { pieceLabels } from '../domain/notice'
import { MAX_REMINDERS, describeOffset, nextOffset, offsetError, reminderState, splitOffset } from '../domain/reminders'
import type { NoticeTone } from '../domain/noticeStatus'
import { useReminders, useSaveReminders } from '../queries'
import type { ReminderHours, ReminderSettings } from '../types'
import { draftOf, offsetOf, parametersOf, slotsOf, startingParameters, type ReminderDraft } from './noticeBuilder'
import { ReminderHoursField } from './ReminderHoursField'
import { ReminderRow } from './ReminderRow'

/** Tarjeta de Integraciones para los recordatorios de cita: se leen de
 *  Google Calendar y salen desde el número de avisos. */
export function ReminderCard() {
  const { data, isLoading, isError } = useReminders()
  const active = data?.reminders.filter(item => item.enabled).length ?? 0
  const ready = Boolean(data?.calendar_ready && data?.sender_ready)
  const state: IntegrationState = active === 0 ? 'unconfigured' : ready ? 'connected' : 'error'
  const stateLabel = active === 0 ? 'Apagado' : ready ? `${active} activo${active === 1 ? '' : 's'}` : 'Falta configurar'
  return (
    <IntegrationCard
      id="recordatorios-cita"
      icon={AlarmClock}
      title="Recordatorios de cita"
      description="Leen las citas de Google Calendar y le escriben al paciente desde el número de avisos antes de su cita."
      state={state}
      stateLabel={stateLabel}
    >
      {isLoading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-wa-muted" aria-label="Cargando recordatorios" />
      ) : isError || !data ? (
        <p className="text-xs text-red-500 dark:text-red-400">No se pudieron cargar los recordatorios.</p>
      ) : (
        <ReminderForm settings={data} />
      )}
    </IntegrationCard>
  )
}

let nextKey = 0
const newKey = () => `r${++nextKey}`

function rowsOf(settings: ReminderSettings, knownKeys: Set<string>): ReminderDraft[] {
  return settings.reminders.map(item => {
    const saved = { templateId: item.template_id ?? null, parameters: item.parameters }
    const template = settings.templates.find(option => option.id === saved.templateId) ?? null
    return {
      key: newKey(), ...splitOffset(item.offset_minutes), enabled: item.enabled, templateId: saved.templateId, saved,
      draft: draftOf(startingParameters(saved, template), slotsOf(template).length, knownKeys),
    }
  })
}

function serialize(rows: ReminderDraft[]): string {
  return JSON.stringify(rows.map(row => [offsetOf(row), row.enabled, row.templateId, parametersOf(row)]))
}

function blankRow(current: ReminderDraft[]): ReminderDraft {
  return {
    key: newKey(), ...splitOffset(nextOffset(current.map(offsetOf))), enabled: false, templateId: null,
    saved: { templateId: null, parameters: [] }, draft: { title: [], lines: [] },
  }
}

/** Un recordatorio activo sin plantilla o con alguna variable vacía. */
function hasIncomplete(rows: ReminderDraft[], templates: ReminderSettings['templates']): boolean {
  return rows.some(row => {
    if (!row.enabled) return false
    const template = templates.find(item => item.id === row.templateId)
    const parameters = parametersOf(row)
    return !template || parameters.length !== slotsOf(template).length || !parameters.every(Boolean)
  })
}

function offsetErrors(rows: ReminderDraft[]): (string | null)[] {
  return rows.map((row, index) => offsetError(offsetOf(row), rows.filter((_, other) => other !== index).map(offsetOf)))
}

/** Un ajuste que se edita sobre lo guardado: solo se guarda lo que el
 *  usuario tocó, así un refresco de la tarjeta (otro número de avisos) no
 *  deja un valor viejo. ``reset`` vuelve a lo guardado. */
function useSavedChoice<T>(saved: T) {
  const [choice, setChoice] = useState<{ value: T } | null>(null)
  const value = choice ? choice.value : saved
  return {
    value,
    changed: JSON.stringify(value) !== JSON.stringify(saved),
    set: (next: T) => setChoice({ value: next }),
    reset: () => setChoice(null),
  }
}

function ReminderForm({ settings }: { settings: ReminderSettings }) {
  const save = useSaveReminders()
  const knownKeys = useMemo(() => new Set(settings.fields.map(field => field.key)), [settings.fields])
  const labels = useMemo(() => pieceLabels(settings.fields), [settings.fields])
  const [initialRows] = useState(() => rowsOf(settings, knownKeys))
  const [rows, setRows] = useState(initialRows)
  const manual = useSavedChoice(settings.include_manual_events)
  // null: sin horario, todas las citas.
  const hours = useSavedChoice<ReminderHours | null>(settings.hours ?? null)
  const hoursInvalid = hours.value !== null && hours.value.start >= hours.value.end
  const [baseline, setBaseline] = useState(() => serialize(initialRows))
  const [open, setOpen] = useState(false)

  const errors = offsetErrors(rows)
  const blocked = hasIncomplete(rows, settings.templates) || hoursInvalid || errors.some(Boolean)
  const dirty = serialize(rows) !== baseline || manual.changed || hours.changed

  const change = (apply: () => void) => {
    save.reset()
    apply()
  }
  const update = (key: string, next: ReminderDraft) => change(() => setRows(current => current.map(row => (row.key === key ? next : row))))
  const remove = (key: string) => change(() => setRows(current => current.filter(row => row.key !== key)))
  const add = () => change(() => {
    setOpen(true)
    setRows(current => [...current, blankRow(current)])
  })

  const submit = () => save.mutate(
    {
      include_manual_events: manual.value,
      hours: hours.value,
      reminders: rows.map(row => ({
        offset_minutes: offsetOf(row), enabled: row.enabled, template_id: row.templateId, parameters: parametersOf(row),
      })),
    },
    {
      onSuccess: saved => {
        const next = rowsOf(saved, knownKeys)
        setRows(next)
        setBaseline(serialize(next))
        manual.reset()
        hours.reset()
      },
    },
  )

  return (
    <div className="space-y-3">
      <Readiness settings={settings} />

      {settings.templates.length === 0 ? (
        <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
          Para activarlos, crea en Plantillas una plantilla oficial de categoría Utilidad, visible para todo el equipo, y espera a que Meta la apruebe.
        </p>
      ) : (
        <IntegrationDisclosure
          id="reminders-configuration"
          title={`Recordatorios (${rows.length})`}
          open={open}
          onToggle={() => setOpen(current => !current)}
        >
          <div className="space-y-3">
            {rows.length > 0 && (
              <ul className="space-y-3">
                {rows.map((row, index) => (
                  <ReminderRow
                    key={row.key}
                    row={row}
                    settings={settings}
                    labels={labels}
                    knownKeys={knownKeys}
                    error={errors[index]}
                    disabled={save.isPending}
                    onChange={next => update(row.key, next)}
                    onRemove={() => remove(row.key)}
                  />
                ))}
              </ul>
            )}
            {rows.length < MAX_REMINDERS && (
              <Button variant="secondary" size="sm" onClick={add} disabled={save.isPending}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Agregar recordatorio
              </Button>
            )}
            <ReminderHoursField value={hours.value} disabled={save.isPending} onChange={value => change(() => hours.set(value))} />
            <label className="flex items-start gap-2 text-sm text-wa-text dark:text-wa-text-dark">
              <Checkbox checked={manual.value} onCheckedChange={value => change(() => manual.set(value))} disabled={save.isPending} />
              <span>
                Recordar también los eventos cargados a mano en el calendario
                <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
                  Solo si el evento trae el teléfono del paciente (por ejemplo, &quot;Teléfono: 987 654 321&quot;). Sin lead, los datos de la cita salen como &quot;-&quot;.
                </span>
              </span>
            </label>
            <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
              Si la cita se mueve en el calendario, el recordatorio sale a la hora nueva; si se borra, no sale. Uno que ya no llega a tiempo (por ejemplo, una cita agendada para dentro de tres horas) se saltea. Las citas de prueba nunca recuerdan.
            </p>
          </div>
        </IntegrationDisclosure>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {save.isError && <p role="alert" className="text-xs text-red-500 dark:text-red-400">{extractErrorMessage(save.error)}</p>}
        {save.isSuccess && !dirty && (
          <p role="status" className="inline-flex items-center gap-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
          </p>
        )}
        <Button size="sm" disabled={!dirty || save.isPending || blocked} onClick={submit}>
          {save.isPending ? 'Guardando…' : 'Guardar recordatorios'}
        </Button>
      </div>

      <RecentReminders items={settings.recent} />
    </div>
  )
}

/** Qué falta para que salga alguno: el calendario y el número de avisos. */
function Readiness({ settings }: { settings: ReminderSettings }) {
  const missing = [
    !settings.calendar_ready && 'Conecta Google Calendar en su tarjeta: de ahí se leen las citas.',
    !settings.sender_ready && 'Elige el número de avisos: los recordatorios solo salen desde ese número.',
  ].filter(Boolean) as string[]
  if (missing.length === 0) return null
  return (
    <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      {missing.map(text => <li key={text}>{text}</li>)}
    </ul>
  )
}

const TONES: Record<NoticeTone, string> = {
  success: 'text-green-700 dark:text-green-300',
  neutral: 'text-wa-text dark:text-wa-text-dark',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-300',
}

const DATE = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function RecentReminders({ items }: { items: ReminderSettings['recent'] }) {
  if (items.length === 0) return null
  return (
    <section aria-label="Últimos recordatorios">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">Últimos recordatorios</p>
      <ul className="divide-y divide-wa-border/60 text-xs dark:divide-wa-border-dark/60">
        {items.map(item => {
          const state = reminderState(item)
          return (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
              <span className="font-medium text-wa-text dark:text-wa-text-dark">{item.recipient_name || item.event_summary || 'Evento'}</span>
              <span className="text-wa-muted dark:text-wa-muted-dark">
                {describeOffset(item.offset_minutes)} antes de la cita del {DATE.format(new Date(item.starts_at))}
              </span>
              <span className={cn('ml-auto font-semibold', TONES[state.tone])}>{state.label}</span>
              {item.reason && <span className="w-full text-wa-muted dark:text-wa-muted-dark">{item.reason}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
