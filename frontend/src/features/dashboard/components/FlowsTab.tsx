import { AlertTriangle } from 'lucide-react'
import type { DashboardMetrics } from '../types'
import { who, type DashboardSubject } from './subject'
import { AUTOMATION_TRIGGERS } from '../../automations/public/automationCatalog'
import { formatNumber } from './format'
import { BarList, NoData, Panel, StatGrid, TrendChart } from './primitives'
import { FlowsByFlowPanel } from './FlowsByFlowPanel'
import { FlowTrendChart } from './FlowTrendChart'
import { HoursHeatmap, type HoursReadingOption } from './HoursHeatmap'

interface Props {
  data: DashboardMetrics
  days: number
  subject: DashboardSubject
  onOpenFlows: () => void
}

// Los mismos nombres que usa el editor de automatizaciones: el vendedor ya los
// vio ahí y en "Flujos enviados".
const TRIGGER_LABELS: Record<string, string> = Object.fromEntries(
  AUTOMATION_TRIGGERS.map((trigger) => [trigger.value, trigger.label]),
)
// "Lead nuevo" y "Conversación nueva" se leían como lo mismo: el nombre solo
// no dice que uno pasa una vez por contacto y el otro cada vez que vuelve a escribir.
const TRIGGER_HINTS: Record<string, string> = Object.fromEntries(
  AUTOMATION_TRIGGERS.map((trigger) => [trigger.value, trigger.description]),
)

// Un solo vocabulario en toda la pestaña: una automatización "se inicia" (el
// botón del chat dice "Iniciar automatización"), "a mano" o "sola". Convivían disparar,
// activar, arrancar y "ejecuciones", y se leían como cosas distintas.
const FLOW_READINGS: HoursReadingOption[] = [
  { key: 'flows_manual', label: 'A mano', hint: 'Automatizaciones que alguien lanzó desde un chat. Total del período en cada franja.' },
  { key: 'flows_automatic', label: 'Solas', hint: 'Automatizaciones que empezaron solas. Total del período en cada franja.' },
]

function FailuresPanel({ failures, period }: { failures: DashboardMetrics['automations']['failures']; period: string }) {
  const { failed, total, rate } = failures
  return (
    <Panel anchor="fallos"
      title="Fallos"
      subtitle={
        rate != null
          ? `${rate}% de ${formatNumber(total)} ${total === 1 ? 'automatización iniciada' : 'automatizaciones iniciadas'} · ${period}`
          : 'Ninguna automatización en el período'
      }
    >
      {failed === 0 ? (
        <NoData label="Ninguna automatización falló" />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {failed === 1 ? '1 automatización no llegó a enviarse' : `${formatNumber(failed)} automatizaciones no llegaron a enviarse`}
          </div>
          <BarList items={failures.top_errors} />
        </>
      )}
    </Panel>
  )
}

export function FlowsTab({ data, days, subject, onOpenFlows }: Props) {
  const { automations } = data
  const period = `Últimos ${days} días`
  const active = automations.active_now
  const activeTotal = Object.values(active).reduce((total, value) => total + value, 0)
  const whose = who(subject, { me: 'Las que lancé yo', team: 'Todo el equipo', seller: (name) => `Las que lanzó ${name}` })
  // Lo propio de alguien solo tiene flujos a mano: un automático no lo inicia
  // nadie, y partirlo dejaría una serie siempre en cero.
  const split = subject.kind === 'team' && automations.trend_manual && automations.trend_automatic
    ? { manual: automations.trend_manual, automatic: automations.trend_automatic }
    : null

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel anchor="flujos-por-tipo"
        title="Automatizaciones iniciadas"
        subtitle={`${whose} · ${period}`}
        className="lg:col-span-2"
        action={
          <button
            type="button"
            onClick={onOpenFlows}
            className="shrink-0 text-[11px] font-medium text-wa-primary-strong hover:underline dark:text-wa-primary"
          >
            Ver automatizaciones enviadas
          </button>
        }
      >
        <FlowsByFlowPanel
          flows={automations.by_flow}
          totals={split ? automations.origin_totals ?? null : null}
          onSelect={onOpenFlows}
        />
      </Panel>

      <Panel anchor="quien-activa-flujos" title="Quién lanzó automatizaciones a mano" subtitle={`Ranking del equipo · ${period}`}>
        <BarList items={automations.by_actor} emptyLabel="Nadie lanzó automatizaciones a mano" />
      </Panel>

      <Panel anchor="que-los-dispara" title="Cómo empiezan" subtitle={`El inicio de cada automatización · ${period}`}>
        <BarList items={automations.by_trigger} labels={TRIGGER_LABELS} hints={TRIGGER_HINTS} emptyLabel="Ninguna automatización en el período" />
      </Panel>

      <Panel anchor="flujos-por-dia" title="Automatizaciones por día" subtitle={`${whose} · ${period}`} className="lg:col-span-2">
        {split
          ? <FlowTrendChart manual={split.manual} automatic={split.automatic} />
          : <TrendChart points={automations.trend} label="Automatizaciones" />}
      </Panel>

      <Panel
        anchor="a-que-hora-salen"
        title="A qué hora se inician las automatizaciones"
        subtitle={`${whose} · ${period} · por día de la semana`}
        className="lg:col-span-2"
      >
        <HoursHeatmap
          hours={data.hours}
          days={days}
          readings={split ? FLOW_READINGS : FLOW_READINGS.slice(0, 1)}
          label="A qué hora se inician las automatizaciones"
          // El mapa de una persona se compara con el de otra: mismo tope de color.
          teamScale={subject.kind !== 'team'}
        />
      </Panel>

      <Panel anchor="pendientes-ahora" title="Pendientes ahora mismo" subtitle="Todo lo que falta enviar, aunque se haya iniciado antes del período">
        <StatGrid
          stats={[
            { label: 'Programadas', value: formatNumber(active.scheduled ?? 0), hint: 'Esperando su turno' },
            { label: 'En curso', value: formatNumber(active.running ?? 0) },
            { label: 'Pausadas', value: formatNumber(active.paused ?? 0), hint: 'Pausadas desde su tarjeta' },
          ]}
        />
        {activeTotal === 0 && <p className="mt-3 text-[11px] text-wa-muted">No hay nada en cola.</p>}
      </Panel>

      <FailuresPanel failures={automations.failures} period={period} />
    </div>
  )
}
