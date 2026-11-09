import type { DashboardMetrics } from '../types'
import { formatMoney, formatNumber, formatShortDateTime } from './format'
import { NoData, Panel } from './primitives'
import { SalesPackagesTable } from './SalesPackagesTable'
import { SalesTrendChart, StatTile } from './SalesCharts'
import { percentChange, pointsChange, sparkSeries } from './salesFormat'

interface Props {
  data: DashboardMetrics
  days: number
  isMine: boolean
  onOpenChat: (leadId: string) => void
}

// Por encima de este descuento promedio la fila del vendedor se marca. Es un
// punto de partida; cada negocio debería poder fijarlo (docs/analisis/15 §4.5).
const DISCOUNT_WARNING_RATE = 8

/** Qué se vende, cuánto deja y quién lo cierra, contra la ventana anterior.
 *  Todo responde al período y al alcance de la cabecera, salvo el ranking de
 *  vendedores, que siempre es del equipo. */
export function SalesTab({ data, days, isMine, onOpenChat }: Props) {
  const { sales } = data
  const { totals, previous, currency } = sales
  const period = `Últimos ${days} días`
  const money = (value: number | null) => formatMoney(value, currency)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Ingresos cobrados"
          value={money(totals.revenue)}
          change={percentChange(totals.revenue, previous?.revenue)}
          trend={sparkSeries(sales.trend, 'revenue')}
        />
        <StatTile
          label="Compras"
          value={formatNumber(totals.count)}
          hint={`${formatNumber(totals.buyers)} ${totals.buyers === 1 ? 'cliente' : 'clientes'}`}
          change={percentChange(totals.count, previous?.count)}
          trend={sparkSeries(sales.trend, 'count')}
        />
        <StatTile
          label="Ticket promedio"
          value={money(totals.avg_ticket)}
          change={percentChange(totals.avg_ticket, previous?.avg_ticket)}
        />
        <StatTile
          label="Sesiones vendidas"
          value={formatNumber(totals.sessions)}
          hint="Lo que la clínica se comprometió a atender"
          change={percentChange(totals.sessions, previous?.sessions)}
        />
        <StatTile
          label="Descuentos"
          value={money(totals.discount)}
          hint={totals.discount_rate != null ? `${totals.discount_rate}% bajo el precio de lista` : 'Sin ventas'}
          change={pointsChange(totals.discount_rate, previous?.discount_rate)}
          upIsBad
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel
          title={days >= 90 ? 'Ventas por semana' : 'Ventas por día'}
          subtitle={`${isMine ? 'Lo que cerré' : 'Lo que cerró el equipo'} · comparado con los ${days} días anteriores`}
          className="lg:col-span-2"
        >
          <SalesTrendChart current={sales.trend} previous={sales.previous_trend} days={days} currency={currency} />
        </Panel>

        <Panel
          title="Paquetes más vendidos"
          subtitle="Cada fila es una presentación del catálogo · ordena por la columna que te interese"
          className="lg:col-span-2"
        >
          <SalesPackagesTable packages={sales.by_package} currency={currency} />
        </Panel>

        <Panel title="Ingresos por servicio" subtitle="El tratamiento que buscaba el cliente, sumando todos sus paquetes">
          {sales.by_service.length === 0 ? (
            <NoData label="Sin compras registradas en el período" />
          ) : (
            <ul className="space-y-3">
              {sales.by_service.map((service) => {
                const max = Math.max(sales.by_service[0].revenue, 1)
                const share = totals.revenue ? Math.round((service.revenue / totals.revenue) * 100) : 0
                return (
                  <li key={service.service_id ?? service.name}>
                    <div className="mb-1 flex justify-between gap-3 text-xs">
                      <span className="truncate text-gray-600 dark:text-gray-300">{service.name}</span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-medium text-gray-800 dark:text-wa-text-dark">{money(service.revenue)}</span>
                        <span className="text-wa-muted dark:text-wa-muted-dark">
                          {' '}· {share}% · {formatNumber(service.count)} {service.count === 1 ? 'compra' : 'compras'}
                        </span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
                      <div
                        className="h-full rounded-full bg-viz-1 dark:bg-viz-1-dark"
                        style={{ width: `${(service.revenue / max) * 100}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Por vendedor" subtitle={`Ranking del equipo · ${period}`}>
          {sales.by_seller.length === 0 ? (
            <NoData label="Nadie registró compras en el período" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-wa-border text-[11px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                    <th scope="col" className="py-2 pr-2 text-left font-medium">Vendedor</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Compras</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Ingresos</th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">Ticket</th>
                    <th scope="col" className="py-2 pl-2 text-right font-medium">Descuento</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-gray-800 dark:text-wa-text-dark">
                  {sales.by_seller.map((seller) => {
                    const high = (seller.discount_rate ?? 0) > DISCOUNT_WARNING_RATE
                    return (
                      <tr key={seller.user_id ?? seller.name} className="border-b border-wa-border last:border-0 dark:border-wa-border-dark">
                        <td className="py-2 pr-2">{seller.name}</td>
                        <td className="px-2 py-2 text-right">{formatNumber(seller.count)}</td>
                        <td className="px-2 py-2 text-right">{money(seller.revenue)}</td>
                        <td className="px-2 py-2 text-right">{money(seller.avg_ticket)}</td>
                        <td
                          className={`py-2 pl-2 text-right ${high ? 'font-medium text-viz-3 dark:text-viz-3-dark' : ''}`}
                          title={high ? `Descuento promedio por encima del ${DISCOUNT_WARNING_RATE}%` : undefined}
                        >
                          {seller.discount_rate != null ? `${seller.discount_rate}%` : '—'}
                          {high && <span className="sr-only"> (alto)</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Últimas compras" subtitle="Abre el chat del lead para revisar o corregir la compra" className="lg:col-span-2">
          {sales.recent.length === 0 ? (
            <NoData label="Sin compras registradas en el período" />
          ) : (
            <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
              {sales.recent.map((sale) => (
                <li key={sale.id}>
                  <button
                    type="button"
                    onClick={() => onOpenChat(sale.lead_id)}
                    className="group flex w-full items-center justify-between gap-3 py-2 text-left text-xs"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-800 group-hover:text-wa-primary-strong dark:text-wa-text-dark">
                        {sale.lead_name}
                      </span>
                      <span className="block truncate text-[11px] text-wa-muted">
                        {sale.package_name} · {sale.service_name} · {sale.seller_name}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-gray-800 dark:text-wa-text-dark">{money(sale.amount)}</span>
                      <span className="block text-[11px] text-wa-muted dark:text-wa-muted-dark">
                        {sale.amount < sale.list_price && `Lista ${money(sale.list_price)} · `}
                        {formatShortDateTime(sale.sold_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
