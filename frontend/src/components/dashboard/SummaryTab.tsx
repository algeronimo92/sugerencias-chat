import {
  AlertCircle, CalendarCheck, CheckCircle2, Clock3, MessageCircleReply, MessagesSquare, Send, Tag,
  TrendingUp, Users,
} from 'lucide-react'
import type { ChatFilters, DashboardMetrics } from '../../types'
import { formatDuration, formatNumber } from './format'
import { BarList, MetricCard, NoData, Panel, StatGrid, TrendChart } from './primitives'

interface Props {
  data: DashboardMetrics
  days: number
  isMine: boolean
  onOpenTasks: () => void
  onOpenFlows: () => void
  onOpenChat: (leadId: string) => void
  onFilterChats: (filters: Partial<ChatFilters>) => void
}

/** La hora llega tal como se registró en el formulario (texto), así que no se
 *  reformatea: solo se le pone delante la fecha. */
function formatAppointmentDate(date: string, time: string): string {
  const label = new Date(`${date}T00:00:00`).toLocaleDateString('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  return `${label} · ${time}`
}

export function SummaryTab({ data, days, isMine, onOpenTasks, onOpenFlows, onOpenChat, onFilterChats }: Props) {
  const { summary, pipeline, activity, appointments } = data
  const period = `Últimos ${days} días`
  const leadScope = isMine ? 'Asignados a mí' : 'Base del equipo'

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Citas registradas" value={summary.appointments_created} hint={period} icon={CalendarCheck} />
        <MetricCard label="Flujos que activé" value={summary.flows_started} hint={`${formatNumber(summary.flows_active)} siguen activos`} icon={Send} onClick={onOpenFlows} />
        <MetricCard
          label="Mensajes enviados"
          value={summary.messages_sent}
          hint={`Desde la app · ${period}`}
          icon={MessagesSquare}
        />
        <MetricCard label="Leads etiquetados" value={summary.tagged_leads} hint={data.tags.coverage.rate != null ? `${data.tags.coverage.rate}% de cobertura` : 'Sin leads'} icon={Tag} />
        <MetricCard label="Leads nuevos" value={summary.new_leads} hint={period} icon={TrendingUp} />
        <MetricCard label="Leads totales" value={summary.total_leads} hint={leadScope} icon={Users} />
        <MetricCard
          label="Esperando respuesta"
          value={summary.awaiting_reply}
          hint="Último mensaje del cliente"
          icon={MessageCircleReply}
          danger={summary.awaiting_reply > 0}
          onClick={() => onFilterChats({ lastSender: 'cliente' })}
        />
        <MetricCard
          label="Tareas vencidas"
          value={summary.overdue_tasks}
          hint="Pendientes fuera de plazo"
          icon={AlertCircle}
          danger={summary.overdue_tasks > 0}
          onClick={onOpenTasks}
        />
        <MetricCard label="Tareas completadas" value={summary.completed_tasks} hint={period} icon={CheckCircle2} onClick={onOpenTasks} />
        <MetricCard label="Respuesta promedio" value={formatDuration(summary.avg_response_minutes)} hint="A mensajes del cliente" icon={Clock3} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Leads nuevos por día" className="lg:col-span-2">
          <TrendChart points={data.new_leads_trend} label="Leads" />
        </Panel>

        <Panel
          title="Mensajes enviados por día"
          subtitle="Solo los que salieron de la app: un mensaje escrito desde el celular llega sin autor"
          className="lg:col-span-2"
        >
          <TrendChart points={activity.messages.trend} label="Mensajes" />
        </Panel>

        <Panel
          title="Mi actividad"
          subtitle={isMine ? 'Acciones que registré en el período' : 'Acciones del equipo en el período'}
        >
          <BarList items={activity.by_type} emptyLabel="Sin actividad registrada" />
        </Panel>

        <Panel title="Quién manda más mensajes" subtitle={`Ranking del equipo · ${period}`}>
          <BarList items={activity.messages.by_user} emptyLabel="Nadie envió mensajes desde la app" />
        </Panel>

        <Panel title="Ritmo de atención" subtitle="Conversaciones y leads que se están enfriando">
          <StatGrid
            stats={[
              { label: 'Conversaciones abiertas', value: formatNumber(pipeline.conversations_open) },
              { label: 'Cerradas en el período', value: formatNumber(pipeline.conversations_closed) },
              {
                label: 'Promedio hasta cerrar',
                value: pipeline.avg_close_hours != null ? `${pipeline.avg_close_hours} h` : 'Sin datos',
              },
            ]}
          />
          <p className="mt-4 mb-2 text-[11px] font-medium text-wa-muted dark:text-wa-muted-dark">
            Leads sin ningún toque
          </p>
          <BarList
            items={pipeline.stale}
            onSelect={(name) => {
              const parsed = Number.parseInt(name.replace(/\D/g, ''), 10)
              if (Number.isFinite(parsed)) onFilterChats({ inactiveDays: parsed })
            }}
            emptyLabel="Ningún lead quedó sin atender"
          />
        </Panel>

        <Panel
          title="Próximas citas"
          subtitle="Siguientes 7 días"
          className="lg:col-span-2"
        >
          {appointments.upcoming.length === 0 ? (
            <NoData label="Sin citas agendadas para esta semana" />
          ) : (
            <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
              {appointments.upcoming.map((appointment) => {
                const row = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-800 dark:text-wa-text-dark">
                        {appointment.name}
                      </span>
                      {appointment.treatment && (
                        <span className="block truncate text-[11px] text-wa-muted">{appointment.treatment}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                      {formatAppointmentDate(appointment.date, appointment.time)}
                    </span>
                  </>
                )
                // Sin lead vinculado no hay chat que abrir: la cita se lista
                // igual, pero como texto.
                return (
                  <li key={appointment.id}>
                    {appointment.lead_id ? (
                      <button
                        type="button"
                        onClick={() => onOpenChat(appointment.lead_id!)}
                        className="flex w-full items-center justify-between gap-3 py-2 text-left text-xs transition-colors hover:text-wa-primary-strong"
                      >
                        {row}
                      </button>
                    ) : (
                      <div
                        className="flex w-full items-center justify-between gap-3 py-2 text-xs"
                        title="Esta cita no quedó vinculada a ningún lead"
                      >
                        {row}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
