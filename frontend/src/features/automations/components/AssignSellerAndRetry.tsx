import { useState } from 'react'
import { toast } from 'sonner'
import { Select } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useUpdateLead } from '../../leads/public/queries'
import { useSellers } from '../../platform/public/useUsers'
import { useRetryExecution } from '../queries'

interface Props {
  executionId: number
  leadId: string
  disabled: boolean
}

/**
 * Para una automatización que falló porque el lead no tiene vendedora: se
 * elige una, se le asigna el lead y se reintenta, en un solo gesto.
 *
 * «Reintentar» a secas volvía a fallar por lo mismo, y arreglarlo pedía ir al
 * chat, asignar la vendedora y volver a esta pantalla.
 */
export function AssignSellerAndRetry({ executionId, leadId, disabled }: Props) {
  const { data: sellers = [] } = useSellers()
  const assign = useUpdateLead(leadId)
  const retry = useRetryExecution()
  const [sellerId, setSellerId] = useState<number | null>(null)
  const working = assign.isPending || retry.isPending

  async function assignAndRetry() {
    if (sellerId === null) return
    try {
      await assign.mutateAsync({ vendedor_id: sellerId })
      await retry.mutateAsync({ id: executionId })
      toast.success('Vendedora asignada y ejecución reprogramada')
    } catch (error) {
      toast.error(extractErrorMessage(error))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Vendedora para este lead"
        value={sellerId ?? ''}
        disabled={disabled || working}
        onChange={event => setSellerId(event.target.value ? Number(event.target.value) : null)}
        className="min-h-9 w-44 text-xs"
      >
        <option value="">Elegir vendedora…</option>
        {sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
      </Select>
      <button
        type="button" disabled={disabled || working || sellerId === null} onClick={assignAndRetry}
        className="inline-flex min-h-9 items-center rounded-lg bg-accent-fill px-3 text-xs font-semibold text-on-accent outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--accent-fill),#000_8%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Asignar y reintentar
      </button>
    </div>
  )
}
