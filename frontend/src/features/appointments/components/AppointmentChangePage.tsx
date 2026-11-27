import { CalendarCheck, CalendarSync } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Input, labelClass } from '../../../shared/ui/Input'
import { PageHeader } from '../../../shared/ui/PageHeader'
import { PageLoader } from '../../../shared/ui/PageLoader'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useAppointment, useConfirmAppointmentCalendarChange } from '../queries'

const DATE_TIME = new Intl.DateTimeFormat('es-PE', { dateStyle: 'full', timeStyle: 'short' })

function crmWhen(fecha: string, hora: string): string {
  const date = new Date(`${fecha}T${hora}`)
  return Number.isNaN(date.getTime()) ? `${fecha} ${hora}` : DATE_TIME.format(date)
}

function calendarWhen(startsAt: string | null | undefined): string {
  if (!startsAt) return 'Sin hora'
  const date = new Date(startsAt)
  return Number.isNaN(date.getTime()) ? startsAt : DATE_TIME.format(date)
}

/**
 * Confirmar una cita que se cambió a mano en Google Calendar. El equipo
 * reprograma o cambia el tratamiento en el calendario, y el CRM se quedaba
 * con los datos viejos: los recordatorios salían con el tratamiento de antes
 * (2026-11-27, una paciente recibió "HIFU 12D" por una cita de Botox). Mientras no
 * se confirme, la cita no manda recordatorios. Se llega desde la notificación.
 */
export function AppointmentChangePage() {
  const { appointmentId } = useParams<{ appointmentId: string }>()
  const id = Number(appointmentId)
  const appointment = useAppointment(id)
  const confirm = useConfirmAppointmentCalendarChange()
  const change = appointment.data?.calendar_change ?? null
  const [tratamiento, setTratamiento] = useState('')

  useEffect(() => {
    if (change) setTratamiento(current => current || change.suggested_treatment || '')
  }, [change])

  if (appointment.isLoading) return <PageLoader />
  if (appointment.isError || !appointment.data) {
    return (
      <EmptyState
        icon={CalendarSync}
        title="No se encontró la cita"
        description={appointment.error ? extractErrorMessage(appointment.error) : undefined}
        action={<Button asChild variant="secondary"><Link to="/citas/nueva">Ir a citas</Link></Button>}
      />
    )
  }

  const item = appointment.data
  if (!change) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="Esta cita no tiene cambios por confirmar"
        description={`${item.nombre_completo}: ${item.tratamiento}, ${crmWhen(item.fecha, item.hora)}. Sus recordatorios salen con estos datos.`}
        action={<Button asChild variant="secondary"><Link to="/citas/nueva">Ir a citas</Link></Button>}
      />
    )
  }

  const submit = () => {
    const value = tratamiento.trim()
    if (!value) return
    confirm.mutate({ id, tratamiento: value }, {
      onSuccess: () => toast.success('Cambio confirmado: los recordatorios salen con los datos nuevos'),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  return (
    <div className="min-h-full bg-canvas">
      <PageHeader
        title="Cita cambiada en el calendario"
        description="Confirma qué servicio tiene la cita ahora. Hasta entonces no se le mandan recordatorios."
      />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 md:px-8">
        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg-muted">En el CRM</h2>
            <p className="mt-2 font-semibold text-fg">{item.tratamiento}</p>
            <p className="text-sm text-fg">{crmWhen(item.fecha, item.hora)}</p>
            <p className="mt-1 text-sm text-fg-muted">{item.nombre_completo}</p>
          </section>
          <section className="rounded-lg border border-warning bg-warning-soft p-4">
            <h2 className="text-sm font-semibold text-warning-fg">En Google Calendar</h2>
            <p className="mt-2 font-semibold text-fg">{change.summary}</p>
            <p className="text-sm text-fg">{calendarWhen(change.starts_at)}</p>
          </section>
        </div>

        <form
          className="rounded-lg border border-line bg-surface p-4"
          onSubmit={event => { event.preventDefault(); submit() }}
        >
          <label htmlFor="appointment-change-treatment" className={labelClass}>Servicio de la cita</label>
          <Input
            id="appointment-change-treatment"
            value={tratamiento}
            onChange={event => setTratamiento(event.target.value)}
            maxLength={200}
            placeholder="Ej.: Botox full face"
            autoComplete="off"
          />
          <p className="mt-2 text-xs text-fg-muted">
            Es el que se le nombra al paciente en los recordatorios. La fecha y la hora se toman del calendario.
          </p>
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={!tratamiento.trim() || confirm.isPending} loading={confirm.isPending}>
              Confirmar cambio
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
