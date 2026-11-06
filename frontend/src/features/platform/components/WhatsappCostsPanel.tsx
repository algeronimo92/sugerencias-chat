import { Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useSyncWhatsappCosts, useWhatsappCosts } from '../hooks/useWhatsapp'

// Valores literales que manda Meta en pricing_analytics.
const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  MARKETING_LITE: 'Marketing (lite)',
  UTILITY: 'Utilidad',
  AUTHENTICATION: 'Autenticación',
  AUTHENTICATION_INTERNATIONAL: 'Autenticación internacional',
  SERVICE: 'Servicio (respuestas)',
  REFERRAL_CONVERSION: 'Anuncio',
}

const TYPE_LABELS: Record<string, string> = {
  REGULAR: 'Cobrado',
  FREE_CUSTOMER_SERVICE: 'Gratis · cupo mensual',
  FREE_ENTRY_POINT: 'Gratis · ventana por anuncio',
}

function monthValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function lastMonths(count: number) {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1)
    return {
      value: monthValue(date),
      label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    }
  })
}

function formatMoney(amount: number, currency: string | null | undefined) {
  if (!currency) return amount.toFixed(2)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 4 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** Lo que Meta informó que cobró por WhatsApp. Desde el 1 de octubre de 2026
 *  se cobran también las respuestas pasado el cupo gratis y las plantillas de
 *  utilidad dentro de las 24 h: sin esto el negocio lo ve recién en la factura. */
export function WhatsappCostsPanel() {
  const months = useMemo(() => lastMonths(6), [])
  const [month, setMonth] = useState(months[0].value)
  const { data, isLoading, isError } = useWhatsappCosts(month)
  const { mutate: sync, isPending: isSyncing } = useSyncWhatsappCosts(month)

  function handleSync() {
    sync(undefined, {
      onError: (error) => toast.error(extractErrorMessage(error)),
    })
  }

  const freeUsed = data?.free_service_used ?? 0
  const freeLimit = data?.free_service_limit ?? 1000
  const freePercent = Math.min(100, Math.round((freeUsed / freeLimit) * 100))
  const hasData = !!data && data.breakdown.length > 0

  return (
    <section className="space-y-3 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Costos de WhatsApp (Meta)</h3>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="whatsapp-costs-month">Mes</label>
          <select
            id="whatsapp-costs-month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="h-7 rounded-md border border-wa-border bg-white px-2 text-xs text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
          >
            {months.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Actualizar
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando costos…</p>
      ) : isError ? (
        <p className="text-xs text-red-600 dark:text-red-400">No se pudieron cargar los costos.</p>
      ) : !hasData ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
          Todavía no hay datos de Meta para este mes. Se copian solos cada 6 horas; con «Actualizar» los pedís ahora.
        </p>
      ) : (
        <>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-wa-text dark:text-wa-text-dark">
              {formatMoney(data.total_cost, data.currency)}
            </p>
            <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
              {data.billed_messages.toLocaleString()} mensajes cobrados · {data.free_messages.toLocaleString()} gratis
            </p>
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-wa-muted dark:text-wa-muted-dark">
              <span>Respuestas gratis del mes</span>
              <span className="tabular-nums">{freeUsed.toLocaleString()} de {freeLimit.toLocaleString()}</span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-wa-field dark:bg-wa-field-dark"
              role="progressbar"
              aria-label="Respuestas gratis usadas"
              aria-valuenow={freeUsed}
              aria-valuemin={0}
              aria-valuemax={freeLimit}
            >
              <div
                className={`h-full ${freePercent >= 90 ? 'bg-red-500' : freePercent >= 70 ? 'bg-amber-500' : 'bg-wa-primary'}`}
                style={{ width: `${freePercent}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
              Pasadas las {freeLimit.toLocaleString()} respuestas del mes, Meta cobra cada mensaje dentro de la ventana de 24 h.
            </p>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-wa-muted dark:text-wa-muted-dark">
                <th className="py-1 font-medium">Tipo de mensaje</th>
                <th className="py-1 font-medium">Precio</th>
                <th className="py-1 text-right font-medium">Mensajes</th>
                <th className="py-1 text-right font-medium">Costo</th>
              </tr>
            </thead>
            <tbody className="text-wa-text dark:text-wa-text-dark">
              {data.breakdown.map((row) => (
                <tr key={`${row.pricing_category}-${row.pricing_type}`} className="border-t border-wa-border dark:border-wa-border-dark">
                  <td className="py-1">{CATEGORY_LABELS[row.pricing_category] ?? row.pricing_category}</td>
                  <td className="py-1 text-wa-muted dark:text-wa-muted-dark">{TYPE_LABELS[row.pricing_type] ?? row.pricing_type}</td>
                  <td className="py-1 text-right tabular-nums">{row.volume.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(row.cost, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
        Cifras aproximadas que informa Meta en la moneda de tu cuenta de WhatsApp; la factura de Meta es la referencia final.
        {data?.last_synced_at && ` Última actualización: ${new Date(data.last_synced_at).toLocaleString()}.`}
      </p>
    </section>
  )
}
