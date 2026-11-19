import { AlertTriangle, PhoneMissed } from 'lucide-react'

import type { DashboardCalls, DashboardMetrics } from '../types'
import { answerRateLabel } from './callsFormat'
import { formatNumber } from './format'
import { NoData, Panel, StatGrid } from './primitives'

type Calls = DashboardCalls
type Cause = Calls['failed_by_cause'][number]

const GROUP_LABELS: Record<string, string> = {
  team: 'Lo resuelve el equipo',
  device: 'Dispositivo o red de quien atiende',
  customer: 'Del cliente',
  account: 'Cuenta de WhatsApp',
  system: 'Sistema: avisar a soporte',
}

function duration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function CauseList({ causes, total }: { causes: Cause[]; total: number }) {
  const max = Math.max(...causes.map(cause => cause.count), 1)
  return (
    <ul className="space-y-3">
      {causes.map(cause => (
        <li key={cause.cause}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-wa-text dark:text-wa-text-dark">{cause.label}</span>
            <span className="shrink-0 tabular-nums text-wa-muted dark:text-wa-muted-dark">{formatNumber(cause.count)} de {formatNumber(total)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
            <div className="h-full rounded-full bg-viz-failed dark:bg-viz-failed-dark" style={{ width: `${(cause.count / max) * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
            <span className="font-medium">{GROUP_LABELS[cause.group] ?? cause.group}</span>
            {cause.action ? ` · ${cause.action}` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

function HoursBars({ hours }: { hours: Calls['by_hour'] }) {
  if (hours.length === 0) return <NoData label="Sin llamadas de clientes en el período" />
  const max = Math.max(...hours.map(slot => slot.answered + slot.missed), 1)
  return (
    <ul className="space-y-1.5" aria-label="Llamadas de clientes por hora">
      {hours.map(slot => (
        <li key={slot.hour} className="flex items-center gap-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          <span className="w-10 shrink-0 tabular-nums">{String(slot.hour).padStart(2, '0')}:00</span>
          <span className="flex h-3 flex-1 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
            <span className="h-full bg-wa-primary-strong" style={{ width: `${(slot.answered / max) * 100}%` }} />
            <span className="h-full bg-viz-failed dark:bg-viz-failed-dark" style={{ width: `${(slot.missed / max) * 100}%` }} />
          </span>
          <span className="w-28 shrink-0 text-right tabular-nums">{slot.answered} atendidas · {slot.missed} perdidas</span>
        </li>
      ))}
    </ul>
  )
}

interface Props {
  data: DashboardMetrics
  days: number
  /** El analista no abre chats: ve la lista sin enlaces. */
  onOpenChat?: (chatId: string) => void
}

/** Llamadas de WhatsApp: cuántas se atienden, cuáles se perdieron y por qué,
 *  y qué falló. Perdidas y fallidas van separadas: unas se arreglan con
 *  horario y gente, las otras son técnicas o de la cuenta. */
export function CallsTab({ data, days, onOpenChat }: Props) {
  const calls = data.calls
  const period = `Últimos ${days} días`
  if (!calls || calls.total === 0) {
    return <Panel anchor="llamadas" title="Llamadas de WhatsApp" subtitle={period}><NoData label="No hubo llamadas en el período" /></Panel>
  }
  const accountIssues = calls.failed_by_cause.filter(cause => cause.group === 'account')
  const topAgent = calls.failed_by_agent[0]
  const deviceFailures = calls.failed_by_agent.reduce((total, agent) => total + agent.count, 0)
  const missedTotal = calls.inbound_missed

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {accountIssues.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 lg:col-span-2 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            {accountIssues.map(cause => (
              <p key={cause.cause}><span className="font-semibold">{cause.label}.</span> {cause.action}.</p>
            ))}
          </div>
        </div>
      )}

      <Panel anchor="llamadas-atencion" title="Atención de llamadas" subtitle={`Las que hicieron tus clientes · ${period}`} className="lg:col-span-2">
        <StatGrid
          stats={[
            { label: 'Atendidas', value: formatNumber(calls.inbound_answered) },
            { label: 'Perdidas', value: formatNumber(calls.inbound_missed), hint: calls.quick_hangups ? `Sin contar ${calls.quick_hangups} que colgaron enseguida` : undefined },
            { label: 'Tasa de atención', value: answerRateLabel(calls), hint: 'Si baja mucho, WhatsApp oculta el botón de llamar' },
            { label: 'Duración media', value: duration(calls.avg_duration_seconds) },
            { label: 'Llamadas a clientes', value: formatNumber(calls.outbound_total), hint: `${formatNumber(calls.outbound_answered)} contestadas` },
          ]}
        />
      </Panel>

      <Panel anchor="llamadas-por-hora" title="A qué hora llaman" subtitle={`Atendidas y perdidas por hora · ${period}`} className="lg:col-span-2">
        <HoursBars hours={calls.by_hour} />
      </Panel>

      <Panel anchor="llamadas-perdidas" title="Llamadas perdidas: por qué" subtitle={period}>
        {missedTotal === 0 ? <NoData label="No se perdió ninguna llamada" /> : <CauseList causes={calls.missed_by_cause} total={missedTotal} />}
        {calls.pending_callbacks.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-wa-text dark:text-wa-text-dark">
              <PhoneMissed className="h-3.5 w-3.5" aria-hidden="true" />
              Sin devolver ({calls.pending_callbacks.length})
            </p>
            <ul className="space-y-1">
              {calls.pending_callbacks.map((item) => {
                const when = new Date(item.ringing_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                return (
                  <li key={item.chat_id} className="text-xs text-wa-muted dark:text-wa-muted-dark">
                    {onOpenChat
                      ? <button type="button" onClick={() => onOpenChat(item.chat_id)} className="font-medium text-wa-primary-strong hover:underline dark:text-wa-primary">Abrir chat · {when}</button>
                      : when}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Panel>

      <Panel
        anchor="llamadas-fallos"
        title="Llamadas con fallo: causas"
        subtitle={calls.failed_total ? `${formatNumber(calls.failed_total)} de ${formatNumber(calls.total)} llamadas · ${period}` : period}
      >
        {calls.failed_total === 0 ? (
          <NoData label="Ninguna llamada falló" />
        ) : (
          <>
            <CauseList causes={calls.failed_by_cause} total={calls.failed_total} />
            {topAgent && deviceFailures >= 3 && topAgent.count / deviceFailures >= 0.6 && (
              <p className="mt-3 rounded-lg bg-wa-app p-2.5 text-xs text-wa-text dark:bg-wa-head-dark dark:text-wa-text-dark">
                {topAgent.count} de {deviceFailures} fallos de audio fueron de {topAgent.name}: conviene revisar su equipo o su red.
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
