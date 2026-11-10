import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Select } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useLeadServices, useReassignServiceLeads } from '../hooks/useLeadServices'

const NONE = ''

/**
 * Atajo para cuando un servicio lo usan decenas de leads: pasarlos todos a
 * "Sin servicio" (o a otro servicio activo, típico con un duplicado del ERP)
 * en un paso, en vez de abrir cada chat. Pide confirmar con el número de leads
 * a la vista, porque cambia muchas fichas de una vez y no hay un "deshacer"
 * en bloque (cada cambio queda en la actividad de su lead).
 */
export function ReassignServiceLeads({ serviceName, leadCount }: { serviceName: string; leadCount: number }) {
  const [target, setTarget] = useState(NONE)
  const [confirming, setConfirming] = useState(false)
  const { data: services = [] } = useLeadServices()
  const reassign = useReassignServiceLeads()
  const others = services.filter(service => service.name !== serviceName)
  const leads = leadCount === 1 ? '1 lead' : `${leadCount} leads`
  const destination = target === NONE ? 'sin servicio' : `con «${target}»`

  function apply() {
    reassign.mutate({ fromService: serviceName, toService: target === NONE ? null : target }, {
      onSuccess: updated => {
        setConfirming(false)
        toast.success(`${updated === 1 ? '1 lead quedó' : `${updated} leads quedaron`} ${destination}`)
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <div className="mt-3 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
      <label htmlFor="reassign-service-target" className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">
        {leadCount === 1 ? 'Pasar el lead a' : `Pasar los ${leads} a`}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <Select id="reassign-service-target" value={target} onValueChange={value => { setTarget(value); setConfirming(false) }} disabled={reassign.isPending} className="min-w-0 flex-1">
          <option value={NONE}>Sin servicio</option>
          {others.map(service => <option key={service.id} value={service.name}>{service.name}</option>)}
        </Select>
        {!confirming && (
          <Button type="button" variant="secondary" size="sm" className="h-9 shrink-0" onClick={() => setConfirming(true)}>
            Aplicar
          </Button>
        )}
      </div>
      {confirming && (
        // Al aparecer se trae a la vista: en un cuadro con scroll podía
        // quedar debajo del borde y parecer que "Aplicar" no hacía nada.
        <div role="alert" ref={node => node?.scrollIntoView?.({ block: 'nearest' })} className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Vas a dejar <strong>{leads}</strong> {destination}. Cambia el servicio de interés de todos a la vez y no se
              puede deshacer en bloque; cada cambio queda en la actividad de su lead.
            </span>
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={reassign.isPending}>
              Cancelar
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={apply} disabled={reassign.isPending}>
              {reassign.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {reassign.isPending ? `Cambiando ${leads}…` : `Sí, cambiar ${leads}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
