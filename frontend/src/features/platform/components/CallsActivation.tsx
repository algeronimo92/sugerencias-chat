import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { WEEK_DAYS, hoursError, hoursFormFrom, hoursSlots, type HoursForm, type WeekDay } from '../callingReadiness'
import { useCallingSettings, useSaveCallingSettings } from '../hooks/useWhatsapp'
import type { CallingSettings } from '../types'

const muted = 'text-wa-muted dark:text-wa-muted-dark'
const timeInput = 'rounded-md border border-wa-border bg-white px-2 py-1.5 text-sm text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'

function ActivationForm({ settings }: { settings: CallingSettings }) {
  const { mutate: save, isPending } = useSaveCallingSettings()
  const [form, setForm] = useState<HoursForm>(() => hoursFormFrom(settings.hours))
  const error = hoursError(form)
  const noAgents = settings.agents === 0

  function toggleDay(day: WeekDay) {
    setForm(current => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter(item => item !== day) : [...current.days, day],
    }))
  }

  function submit(enabled: boolean) {
    save({ enabled, hours: enabled ? hoursSlots(form) : [] }, {
      onSuccess: () => toast.success(enabled ? 'Llamadas activadas' : 'Llamadas desactivadas'),
      onError: failure => toast.error(extractErrorMessage(failure)),
    })
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-wa-text dark:text-wa-text-dark">Horario de atención de llamadas</h4>
        <p className={`text-[11px] ${muted}`}>
          Fuera de este horario tus clientes no pueden llamar. Si muchas llamadas quedan sin atender, WhatsApp oculta el botón de llamar.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días de atención">
        {WEEK_DAYS.map(([day, label]) => {
          const on = form.days.includes(day)
          return (
            <button
              key={day} type="button" aria-pressed={on} onClick={() => toggleDay(day)}
              className={`min-h-9 min-w-11 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${on ? 'border-wa-primary-strong bg-wa-primary-strong text-white' : 'border-wa-border text-wa-text dark:border-wa-border-dark dark:text-wa-text-dark'}`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-wa-text dark:text-wa-text-dark">
          <span className="mb-1 block">Desde</span>
          <input type="time" value={form.open} onChange={event => setForm({ ...form, open: event.target.value })} className={timeInput} />
        </label>
        <label className="text-xs text-wa-text dark:text-wa-text-dark">
          <span className="mb-1 block">Hasta</span>
          <input type="time" value={form.close} onChange={event => setForm({ ...form, close: event.target.value })} className={timeInput} />
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {noAgents && !settings.enabled && (
        <p className={`text-xs ${muted}`}>Elige primero quiénes atienden: sin nadie, las llamadas sonarían en el vacío.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={isPending || Boolean(error) || (noAgents && !settings.enabled)} onClick={() => submit(true)}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {settings.enabled ? 'Guardar horario' : 'Activar llamadas'}
        </Button>
        {settings.enabled && (
          <Button variant="secondary" size="sm" disabled={isPending} onClick={() => submit(false)}>Desactivar</Button>
        )}
        <span role="status" className={`text-xs ${settings.enabled ? 'font-medium text-green-700 dark:text-green-300' : muted}`}>
          {settings.enabled ? 'Las llamadas están activas' : 'Las llamadas están apagadas'}
        </span>
      </div>
    </div>
  )
}

/** Activar las llamadas en Meta y su horario. Solo se muestra cuando el
 *  número cumple los requisitos. */
export function CallsActivation() {
  const { data, isLoading, isError, refetch } = useCallingSettings()
  if (isLoading) return <p className={`text-xs ${muted}`}>Leyendo la configuración de llamadas…</p>
  if (isError || !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-red-600 dark:text-red-400">
        No se pudo leer la configuración de llamadas en Meta.
        <Button variant="secondary" size="sm" onClick={() => refetch()}>Reintentar</Button>
      </div>
    )
  }
  return <ActivationForm settings={data} />
}
