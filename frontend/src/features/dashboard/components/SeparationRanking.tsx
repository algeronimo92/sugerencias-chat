import type { DashboardSeparationRankRow } from '../types'
import { formatMoney, formatNumber } from './format'
import { NoData } from './primitives'

interface Props {
  rows: DashboardSeparationRankRow[]
  /** Encabezado de la primera columna: "Registró", "Vendedora". */
  who: string
  currency: string | null
  emptyLabel: string
}

/** Tabla de separaciones por persona: cuántas, cuánto y qué parte dejó adelanto. */
export function SeparationRanking({ rows, who, currency, emptyLabel }: Props) {
  if (rows.length === 0) return <NoData label={emptyLabel} />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-wa-border text-[11px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
            <th scope="col" className="py-2 pr-2 text-left font-medium">{who}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Separaciones</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Monto</th>
            <th scope="col" className="py-2 pl-2 text-right font-medium">Con adelanto</th>
          </tr>
        </thead>
        <tbody className="tabular-nums text-gray-800 dark:text-wa-text-dark">
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-wa-border last:border-0 dark:border-wa-border-dark">
              <td className="py-2 pr-2">{row.name}</td>
              <td className="px-2 py-2 text-right">{formatNumber(row.count)}</td>
              <td className="px-2 py-2 text-right">{formatMoney(row.amount, currency)}</td>
              <td className="py-2 pl-2 text-right">
                {row.count ? `${Math.round((row.with_deposit / row.count) * 100)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
