import { ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { editFieldHref } from '../../../shared/navigation/editFieldLink'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useDeleteLeadService, useServiceUsage } from '../hooks/useLeadServices'
import type { LeadService, ServiceUsageGroup } from '../types'
import { ReassignServiceLeads } from './ReassignServiceLeads'

/** Adónde ir a quitar el servicio de cada cosa que lo usa. Un lead se abre
 *  con su servicio de interés listo para cambiar y resaltado, no solo el chat. */
function usageHref(kind: string, id: string, serviceName: string): string {
  if (kind === 'leads') {
    return editFieldHref(`/chat/${id}`, 'servicio_interes', `Cámbialo o quítalo para poder eliminar «${serviceName}» del catálogo.`)
  }
  if (kind === 'ventas') return `/chat/${id}`
  if (kind === 'plantillas') return '/templates'
  if (kind === 'automatizaciones') return '/automations'
  return '/ai-assistant'
}

function UsageList({ usages, serviceName }: { usages: ServiceUsageGroup[]; serviceName: string }) {
  return (
    <ul aria-label="Dónde se usa" className="mt-3 max-h-64 space-y-3 overflow-y-auto text-sm">
      {usages.map(usage => {
        const items = usage.items ?? []
        return (
          <li key={usage.kind}>
            <p className="font-semibold text-wa-text dark:text-wa-text-dark">{usage.label}</p>
            <ul className="mt-1 space-y-0.5">
              {items.map(item => (
                <li key={item.id}>
                  <Link to={usageHref(usage.kind, item.id, serviceName)} className="inline-flex items-center gap-1 text-wa-primary-strong hover:underline dark:text-wa-primary">
                    {item.name}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </li>
              ))}
              {usage.count > items.length && (
                <li className="text-wa-muted dark:text-wa-muted-dark">y {usage.count - items.length} más</li>
              )}
            </ul>
            {usage.kind === 'leads' && <ReassignServiceLeads serviceName={serviceName} leadCount={usage.count} />}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Solo para lo cargado a mano: un servicio creado por error ya no queda para
 * siempre en el listado. Al abrir el cuadro se consulta qué lo usa y se
 * muestra con enlaces (cada lead, a su chat): antes el aviso decía "está en
 * uso: 1 lead" sin decir cuál, y no había forma de encontrarlo.
 */
export function DeleteServiceButton({ service }: { service: LeadService }) {
  const [open, setOpen] = useState(false)
  const usage = useServiceUsage(service.id, open)
  const deleteService = useDeleteLeadService()
  const usages = usage.data ?? []
  const inUse = usages.length > 0

  function handleDelete() {
    deleteService.mutate(service.id, {
      onSuccess: () => toast.success(`"${service.name}" eliminado`),
      onError: err => toast.error(extractErrorMessage(err), { duration: 8000 }),
    })
  }

  let description = 'Nadie lo usa: se borra junto con sus paquetes y no se puede deshacer.'
  let details = null
  if (usage.isPending) {
    description = 'Revisando dónde se usa…'
    details = <Loader2 className="mt-3 h-4 w-4 animate-spin text-wa-muted" aria-hidden="true" />
  } else if (usage.isError) {
    description = `No se pudo revisar dónde se usa (${extractErrorMessage(usage.error)}). Si lo usa algo, no se va a eliminar.`
  } else if (inUse) {
    description = 'No se puede eliminar porque está en uso. Quítalo de cada lugar (por ejemplo, cambia el servicio de interés del lead) o desactívalo: deja de ofrecerse y el historial se conserva.'
    details = <UsageList usages={usages} serviceName={service.name} />
  }

  return (
    <ConfirmDialog
      title={`¿Eliminar "${service.name}"?`}
      description={description}
      details={details}
      confirmLabel="Eliminar"
      confirmDisabled={usage.isPending || inUse}
      disabled={deleteService.isPending}
      onConfirm={handleDelete}
      open={open}
      onOpenChange={setOpen}
    >
      {/* Solo ícono: la fila ya tiene Guardar y Desactivar, y con un tercer
          botón con texto los campos del servicio quedaban demasiado angostos. */}
      <Button variant="ghost" size="sm" className="h-11 w-11 shrink-0 px-0 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40 sm:h-9 sm:w-9" aria-label={`Eliminar ${service.name}`} title="Eliminar servicio">
        {deleteService.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </ConfirmDialog>
  )
}
