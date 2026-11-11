import {
  AlertCircle, CalendarCheck, CheckCircle2, Clock3, MessageCircleReply, MessagesSquare, Send, Tag,
  TrendingUp, Users,
} from 'lucide-react'
import type { ChatFilters } from '../../leads/types'
import type { DashboardMetrics } from '../types'
import { isPersonal, who, type DashboardSubject } from './subject'
import { formatChange, formatDuration, formatMoney, formatNumber } from './format'
import { fromAppointments } from './serviceBreakdown'
import { BarList, MetricCard, NoData, Panel, StatGrid, TrendChart } from './primitives'
import { HoursHeatmap, type HoursReadingOption } from './HoursHeatmap'
import { MessagesByOriginPanel } from './MessagesByOriginPanel'
import { TeamHoursPanel } from './TeamHoursPanel'

// "Cuántas llegan" dice cuándo escribe la gente (y cuándo Meta muestra los
// anuncios); "Siguieron conversando" es lo que responde a qué hora reaccionan
// mejor. Van juntas para no leer el volumen como si fuera calidad.
const CONVERSATION_READINGS: HoursReadingOption[] = [
  { key: 'conversations', label: 'Cuántas llegan', hint: 'Conversaciones nuevas, en promedio por día de la semana.' },
  {
    key: 'engaged',
    label: 'Siguieron conversando',
    hint: '% que volvió a escribir después de nuestra primera respuesta, humana o automática, dentro de las 24 h. Las de hoy aún no cuentan.',
  },
]

// Las dos mitades del trabajo de escribir, sobre la misma cuadrícula: un
// equipo que atiende desde WhatsApp sale en blanco en la primera y aparece en
// la segunda. Los programados y los flujos no entran en ninguna: no dicen a
// qué hora estuvo alguien atendiendo. La segunda solo existe al mirar al
// equipo: esos mensajes no traen autor y no se pueden mostrar como de alguien.
const WRITING_READINGS: HoursReadingOption[] = [
  {
    key: 'messages',
    label: 'En el CRM',
    hint: 'Mensajes escritos y enviados en el momento desde el CRM, por quien los escribió y en cualquier chat. En promedio por día de la semana.',
  },
  {
    key: 'phone_messages',
    // El mismo nombre que en "Mensajes enviados por día": "desde el celular"
    // dejaba afuera WhatsApp Web, que también sale por acá.
    label: 'Desde WhatsApp, fuera del CRM',
    hint: 'Mensajes que salieron por WhatsApp sin pasar por el CRM, de todos los chats. No traen autor, e incluyen respuestas automáticas y difusiones de WhatsApp.',
  },
]

interface Props {
  data: DashboardMetrics
  days: number
  subject: DashboardSubject
  onOpenTasks: () => void
  onOpenFlows: () => void
  onOpenChat: (leadId: string) => void
  onFilterChats: (filters: Partial<ChatFilters>) => void
  onOpenSales: () => void
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

export function SummaryTab({ data, days, subject, onOpenTasks, onOpenFlows, onOpenChat, onFilterChats, onOpenSales }: Props) {
  const { summary, pipeline, activity, appointments } = data
  const period = `Últimos ${days} días`
  const leadScope = who(subject, { me: 'Asignados a mí', team: 'Base del equipo', seller: (name) => `Asignados a ${name}` })
  // La venta del negocio es la separación de cita con su adelanto.
  const { separations } = data.appointments
  const currency = data.currency
  const topTreatments = fromAppointments(data).ranking.slice(0, 8).map((item) => ({ name: item.name, value: item.count ?? 0 }))
  const sellerAmounts = separations.by_seller.slice(0, 8).map((item) => ({ name: item.name, value: Math.round(item.amount) }))
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Citas registradas" value={summary.appointments_created} hint={period} icon={CalendarCheck} />
        <MetricCard label={who(subject, { me: 'Flujos que inicié', team: 'Flujos iniciados', seller: (name) => `Flujos que inició ${name}` })} value={summary.flows_started} hint={`${formatNumber(summary.flows_active)} sin terminar`} icon={Send} onClick={onOpenFlows} />
        <MetricCard
          label="Mensajes escritos en el CRM"
          value={summary.messages_sent}
          hint={`Los envió una persona desde el CRM, no un flujo ni WhatsApp · ${period}`}
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
        <Panel anchor="leads-nuevos-por-dia" title="Leads nuevos por día" className="lg:col-span-2">
          <TrendChart points={data.new_leads_trend} label="Leads" />
        </Panel>

        <Panel
          anchor="horas-de-mas-movimiento"
          title="Horas de más movimiento"
          subtitle={`${who(subject, { me: 'Mis leads', team: 'Todo el equipo', seller: (name) => `Leads de ${name}` })} · ${period} · por día de la semana y franja de ${data.hours?.slot_hours ?? 2} horas`}
          className="lg:col-span-2"
        >
          <HoursHeatmap hours={data.hours} days={days} readings={CONVERSATION_READINGS} label="Horas de más movimiento" />
        </Panel>

        <Panel anchor="mensajes-por-dia"
          title={days >= 90 ? 'Mensajes enviados por semana' : 'Mensajes enviados por día'}
          subtitle={`${who(subject, { me: 'Lo que mandó el negocio en mis chats', team: 'Todo lo que mandó el negocio', seller: (name) => `Lo que mandó el negocio en los chats de ${name}` })}, según de dónde salió · ${period}`}
          className="lg:col-span-2"
        >
          <MessagesByOriginPanel points={activity.messages.by_origin ?? []} days={days} />
        </Panel>

        <Panel
          anchor="a-que-hora-se-escribe"
          title="A qué hora se escribe a los clientes"
          subtitle={`${who(subject, { me: 'Yo', team: 'Todo el equipo', seller: (name) => name })} · ${period} · por día de la semana y franja de ${data.hours?.slot_hours ?? 2} horas`}
          className="lg:col-span-2"
        >
          <HoursHeatmap
            hours={data.hours}
            days={days}
            readings={isPersonal(subject) ? WRITING_READINGS.slice(0, 1) : WRITING_READINGS}
            label="A qué hora se escribe a los clientes"
            teamScale={isPersonal(subject)}
          />
        </Panel>

        {/* Solo al mirar al equipo: con una persona elegida no hay con quién
            compararla, y su mapa ya es el panel de arriba. */}
        {subject.kind === 'team' && (
          <Panel
            anchor="horas-por-persona"
            title="Quién atiende y a qué hora"
            subtitle={`Lo que cada persona hizo en el CRM y, aparte, lo que salió por WhatsApp · ${period} · franjas de ${data.hours?.slot_hours ?? 2} horas`}
            className="lg:col-span-2"
          >
            <TeamHoursPanel hours={data.hours} />
          </Panel>
        )}

        <Panel anchor="actividad"
          title={who(subject, { me: 'Mi actividad', team: 'Actividad del equipo', seller: (name) => `Actividad de ${name}` })}
          subtitle={who(subject, { me: 'Acciones que registré en el período', team: 'Acciones del equipo en el período', seller: (name) => `Acciones de ${name} en el período` })}
        >
          <BarList items={activity.by_type} emptyLabel="Sin actividad registrada" />
        </Panel>

        <Panel anchor="quien-manda-mensajes" title="Quién escribe más en el CRM" subtitle={`Solo los mensajes escritos en el CRM: lo que sale desde WhatsApp llega sin autor · ranking del equipo · ${period}`}>
          <BarList items={activity.messages.by_user} emptyLabel="Nadie escribió mensajes en el CRM en el período" />
        </Panel>

        <Panel anchor="ventas"
          title="Ventas"
          subtitle={`${who(subject, { me: 'Lo que separé', team: 'Lo que separó el equipo', seller: (name) => `Lo que separó ${name}` })} · ${period}`}
          action={
            <button
              type="button"
              onClick={onOpenSales}
              className="shrink-0 text-xs font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary"
            >
              Ver ventas
            </button>
          }
        >
          <StatGrid
            stats={[
              {
                label: 'Separaciones',
                value: formatNumber(separations.totals.count),
                hint: formatChange(separations.totals.count, separations.previous?.count),
              },
              {
                label: 'Monto de separación',
                value: formatMoney(separations.totals.amount, currency),
                hint: formatChange(separations.totals.amount, separations.previous?.amount),
              },
              {
                label: 'Adelanto promedio',
                value: formatMoney(separations.totals.avg_deposit, currency),
                hint: formatChange(separations.totals.avg_deposit, separations.previous?.avg_deposit),
              },
            ]}
          />
          {!isPersonal(subject) && (
            <>
              <p className="mt-4 mb-2 text-[11px] font-medium text-wa-muted dark:text-wa-muted-dark">Quién registró (monto)</p>
              <BarList items={sellerAmounts} emptyLabel="Nadie registró separaciones en el período" />
            </>
          )}
          <p className="mt-4 mb-2 text-[11px] font-medium text-wa-muted dark:text-wa-muted-dark">Tratamientos más separados</p>
          <BarList items={topTreatments} emptyLabel="Sin separaciones en el período" />
        </Panel>

        <Panel anchor="ritmo-de-atencion" title="Ritmo de atención" subtitle="Conversaciones y leads que se están enfriando">
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

        <Panel anchor="proximas-citas"
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
