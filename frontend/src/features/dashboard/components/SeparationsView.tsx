import type { DashboardMetrics } from '../types'
import { formatMoney, formatNumber, formatShortDateTime } from './format'
import { NoData, Panel } from './primitives'
import { SalesTrendChart, StatTile } from './SalesCharts'
import { ServiceBreakdownPanel } from './ServiceBreakdownPanel'
import { percentChange, sparkSeries } from './salesFormat'

interface Props {
  data: DashboardMetrics
  days: number
  isMine: boolean
  onOpenChat: (leadId: string) => void
}

const TREND_LABELS = { revenue: 'Monto', count: 'Separaciones' }

/** La venta del negocio medida como separación de cita: cuántas se cerraron,
 *  cuánto dejaron de adelanto, de qué tratamiento y quién las cerró, contra la
 *  ventana anterior. Se cuentan solo las citas agendadas de verdad (sin
 *  duplicadas, fallidas ni de prueba) por la fecha en que se registraron. */
export function SeparationsView({ data, days, isMine, onOpenChat }: Props) {
  const separations = data.appointments.separations
  const { totals, previous } = separations
  const currency = data.sales.currency
  const money = (value: number | null) => formatMoney(value, currency)
  // La serie viene con "amount"; el gráfico de tendencia la lee como "revenue".
  const asPoints = (points: typeof separations.trend) => points.map((point) => ({ date: point.date, count: point.count, revenue: point.amount }))
  const trend = asPoints(separations.trend)
  const withDepositRate = totals.count ? Math.round((totals.with_deposit / totals.count) * 100) : null

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Monto de separación"
          value={money(totals.amount)}
          hint="Suma de los adelantos"
          change={percentChange(totals.amount, previous?.amount)}
          trend={sparkSeries(trend, 'revenue')}
        />
        <StatTile
          label="Separaciones"
          value={formatNumber(totals.count)}
          hint={`${formatNumber(totals.clients)} ${totals.clients === 1 ? 'clienta' : 'clientas'}`}
          change={percentChange(totals.count, previous?.count)}
          trend={sparkSeries(trend, 'count')}
        />
        <StatTile
          label="Adelanto promedio"
          value={money(totals.avg_deposit)}
          hint="Entre las que dejaron adelanto"
          change={percentChange(totals.avg_deposit, previous?.avg_deposit)}
        />
        <StatTile
          label="Con adelanto"
          value={withDepositRate != null ? `${withDepositRate}%` : 'Sin datos'}
          hint={`${formatNumber(totals.with_deposit)} de ${formatNumber(totals.count)} separaciones`}
          change={percentChange(totals.with_deposit, previous?.with_deposit)}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel
          title={days >= 90 ? 'Separaciones por semana' : 'Separaciones por día'}
          subtitle={`${isMine ? 'Lo que separé' : 'Lo que separó el equipo'} · comparado con los ${days} días anteriores`}
          className="lg:col-span-2"
        >
          {totals.count === 0 && !previous ? (
            <NoData label="Sin separaciones en el período ni en el anterior" />
          ) : (
            <SalesTrendChart current={trend} previous={asPoints(separations.previous_trend)} days={days} currency={currency} labels={TREND_LABELS} />
          )}
        </Panel>

        <Panel
          title="Por tratamiento"
          subtitle={`Cuánto se separó de cada tratamiento por ${days <= 14 ? 'día' : 'semana'} y qué parte del total fue cada uno`}
          className="lg:col-span-2"
        >
          <ServiceBreakdownPanel data={data} days={days} />
        </Panel>

        <Panel title="Por responsable" subtitle={`Ranking del equipo · últimos ${days} días`}>
          {separations.by_seller.length === 0 ? (
            <NoData label="Nadie registró separaciones en el período" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-wa-border text-[11px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                    <th scope="col" className="py-2 pr-2 text-left font-medium">Responsable</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Separaciones</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Monto</th>
                    <th scope="col" className="py-2 pl-2 text-right font-medium">Con adelanto</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-gray-800 dark:text-wa-text-dark">
                  {separations.by_seller.map((seller) => (
                    <tr key={seller.name} className="border-b border-wa-border last:border-0 dark:border-wa-border-dark">
                      <td className="py-2 pr-2">{seller.name}</td>
                      <td className="px-2 py-2 text-right">{formatNumber(seller.count)}</td>
                      <td className="px-2 py-2 text-right">{money(seller.amount)}</td>
                      <td className="py-2 pl-2 text-right">
                        {seller.count ? `${Math.round((seller.with_deposit / seller.count) * 100)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Últimas separaciones" subtitle="Abre el chat de la clienta cuando la cita quedó ligada a su ficha">
          {separations.recent.length === 0 ? (
            <NoData label="Sin separaciones en el período" />
          ) : (
            <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
              {separations.recent.map((row) => {
                const content = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-800 group-hover:text-wa-primary-strong dark:text-wa-text-dark">{row.name}</span>
                      <span className="block truncate text-[11px] text-wa-muted">{row.treatment} · {row.seller_name}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-gray-800 dark:text-wa-text-dark">
                        {row.amount > 0 ? money(row.amount) : 'Sin adelanto'}
                      </span>
                      <span className="block text-[11px] text-wa-muted dark:text-wa-muted-dark">{formatShortDateTime(row.created_at)}</span>
                    </span>
                  </>
                )
                return (
                  <li key={row.id}>
                    {row.lead_id ? (
                      <button type="button" onClick={() => onOpenChat(row.lead_id!)} className="group flex w-full items-center justify-between gap-3 py-2 text-left text-xs">
                        {content}
                      </button>
                    ) : (
                      <div className="flex w-full items-center justify-between gap-3 py-2 text-xs" title="Esta cita no quedó ligada a ningún lead">
                        {content}
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
