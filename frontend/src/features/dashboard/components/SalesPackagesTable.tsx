import { useState } from 'react'
import type { DashboardSalesPackage } from '../types'
import { formatMoney, formatNumber } from './format'
import { NoData } from './primitives'
import { ChangeLabel } from './SalesCharts'
import { percentChange } from './salesFormat'

type SortKey = 'revenue' | 'count' | 'avg_ticket' | 'sessions'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'count', label: 'Compras' },
  { key: 'revenue', label: 'Ingresos' },
  { key: 'avg_ticket', label: 'Ticket prom.' },
  { key: 'sessions', label: 'Sesiones' },
]

// Diez filas se leen de un vistazo; el resto se suma en "Otros" para que el
// total de la tabla siga cerrando con las cifras de arriba.
const VISIBLE_ROWS = 10

function totalSessions(item: DashboardSalesPackage): number {
  return item.sessions * item.count
}

function sortValue(item: DashboardSalesPackage, key: SortKey): number {
  if (key === 'sessions') return totalSessions(item)
  return item[key] ?? 0
}

/** Cada fila es una presentación del catálogo. La barra sigue a la columna
 *  por la que está ordenada la tabla, con un solo color: el largo ya dice el
 *  tamaño y un color por paquete no agregaría información. */
export function SalesPackagesTable({ packages, currency }: { packages: DashboardSalesPackage[]; currency: string | null }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue')

  if (packages.length === 0) {
    return (
      <NoData label='Sin compras registradas en el período. Se registran al mover un lead a una etapa ganada o con "Registrar compra" en su ficha.' />
    )
  }

  const sorted = [...packages].sort(
    (a, b) => sortValue(b, sortKey) - sortValue(a, sortKey) || b.revenue - a.revenue,
  )
  const visible = sorted.slice(0, VISIBLE_ROWS)
  const rest = sorted.slice(VISIBLE_ROWS)
  const max = Math.max(sortValue(visible[0], sortKey), 1)
  const restCount = rest.reduce((sum, item) => sum + item.count, 0)
  const restRevenue = rest.reduce((sum, item) => sum + item.revenue, 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-wa-border text-[11px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
            <th scope="col" className="py-2 pr-3 text-left font-medium">Paquete</th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={sortKey === column.key ? 'descending' : undefined}
                className="px-2 py-2 text-right font-medium"
              >
                <button
                  type="button"
                  onClick={() => setSortKey(column.key)}
                  className={`whitespace-nowrap hover:text-wa-text dark:hover:text-wa-text-dark ${
                    sortKey === column.key ? 'font-semibold text-wa-text dark:text-wa-text-dark' : ''
                  }`}
                >
                  {column.label}
                  {sortKey === column.key && <span aria-hidden="true"> ▾</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="py-2 pl-2 text-right font-medium">vs. anterior</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {visible.map((item) => {
            const isNew = item.previous_count === 0
            return (
              <tr
                key={item.package_id ?? `${item.service_name}·${item.package_name}`}
                className="border-b border-wa-border last:border-0 dark:border-wa-border-dark"
              >
                <td className="py-2 pr-3">
                  <span className="block text-[11px] text-wa-muted dark:text-wa-muted-dark">{item.service_name}</span>
                  <span className="font-medium text-gray-800 dark:text-wa-text-dark">
                    {item.package_name}
                    {item.sessions > 1 && <span className="font-normal text-wa-muted"> · {item.sessions} sesiones</span>}
                  </span>
                  <span className="mt-1.5 block h-1.5 max-w-[220px] overflow-hidden rounded-full bg-wa-field dark:bg-wa-head-dark">
                    <span
                      className="block h-full rounded-full bg-viz-1 dark:bg-viz-1-dark"
                      style={{ width: `${(sortValue(item, sortKey) / max) * 100}%` }}
                    />
                  </span>
                </td>
                <td className="px-2 py-2 text-right text-gray-800 dark:text-wa-text-dark">{formatNumber(item.count)}</td>
                <td className="px-2 py-2 text-right text-gray-800 dark:text-wa-text-dark">{formatMoney(item.revenue, currency)}</td>
                <td className="px-2 py-2 text-right text-gray-800 dark:text-wa-text-dark">{formatMoney(item.avg_ticket, currency)}</td>
                <td className="px-2 py-2 text-right text-gray-800 dark:text-wa-text-dark">{formatNumber(totalSessions(item))}</td>
                <td className="py-2 pl-2 text-right" title={`${formatNumber(item.previous_count)} compras en el período anterior`}>
                  {isNew ? (
                    <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-wa-primary-strong dark:bg-green-950/50 dark:text-wa-primary">
                      Nuevo
                    </span>
                  ) : (
                    <ChangeLabel change={percentChange(item.count, item.previous_count)} />
                  )}
                </td>
              </tr>
            )
          })}
          {rest.length > 0 && (
            <tr className="text-wa-muted dark:text-wa-muted-dark">
              <td className="py-2 pr-3">Otros {rest.length} paquetes</td>
              <td className="px-2 py-2 text-right">{formatNumber(restCount)}</td>
              <td className="px-2 py-2 text-right">{formatMoney(restRevenue, currency)}</td>
              <td className="px-2 py-2 text-right">{formatMoney(restCount ? restRevenue / restCount : null, currency)}</td>
              <td className="px-2 py-2 text-right">{formatNumber(rest.reduce((sum, item) => sum + totalSessions(item), 0))}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
