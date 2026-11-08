import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
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
 *  con su servicio de interés listo para cambiar y resaltado, no solo el chat;
 *  una automatización, abierta en esa regla con lo que nombra al servicio
 *  marcado (antes llevaba a la lista y había que adivinar qué tocar).
 *  `servicio` marca la acción que lo asigna (impide eliminarlo) y
 *  `servicio_filtro`, la condición que filtra por su nombre (solo se avisa). */
function usageHref(kind: string, id: string, serviceName: string): string {
  const reason = `Cámbialo o quítalo para poder eliminar «${serviceName}» del catálogo.`
  if (kind === 'leads') return editFieldHref(`/chat/${id}`, 'servicio_interes', reason)
  if (kind === 'automatizaciones') return editFieldHref('/automations', 'servicio', reason, { record: id, value: serviceName })
  if (kind === 'filtros') {
    const filterReason = `Esta regla filtra por «${serviceName}». No impide eliminar el servicio; cámbiala si ya no corresponde (por ejemplo, por una etiqueta).`
    return editFieldHref('/automations', 'servicio_filtro', filterReason, { record: id, value: serviceName })
  }
  if (kind === 'ventas') return `/chat/${id}`
  if (kind === 'plantillas') return '/templates'
  return '/ai-assistant'
}

function UsageLinks({ usage, serviceName }: { usage: ServiceUsageGroup; serviceName: string }) {
  const items = usage.items ?? []
  const more = usage.count - items.length
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 && ', '}
          <Link to={usageHref(usage.kind, item.id, serviceName)} className="text-wa-primary-strong hover:underline dark:text-wa-primary">
            {item.name.trim() || 'Sin nombre'}
          </Link>
        </Fragment>
      ))}
      {more > 0 && ` y ${more} más`}
    </>
  )
}

/** Lo que usa al servicio, grupo por grupo. Los nombres van seguidos y no
 *  uno por renglón: con 92 leads, diez renglones tapaban todo lo demás. */
function UsageList({ usages, serviceName }: { usages: ServiceUsageGroup[]; serviceName: string }) {
  return (
    <ul aria-label="Dónde se usa" className="mt-3 max-h-56 space-y-2.5 overflow-y-auto text-sm">
      {usages.map(usage => (
        <li key={usage.kind}>
          <p className="font-semibold text-wa-text dark:text-wa-text-dark">{usage.label}</p>
          <p className="mt-0.5 leading-6 text-wa-muted dark:text-wa-muted-dark"><UsageLinks usage={usage} serviceName={serviceName} /></p>
        </li>
      ))}
    </ul>
  )
}

/** Lo que no impide eliminar pero cambia al hacerlo: una regla que filtra por
 *  el nombre del servicio sigue funcionando (es texto, no un vínculo), y puede
 *  dejar de aplicarse o seguir atrapando otro servicio que lo contenga. */
function NoticeList({ notices, serviceName }: { notices: ServiceUsageGroup[]; serviceName: string }) {
  return (
    <ul aria-label="Avisos" className="mt-3 space-y-2 text-xs">
      {notices.map(notice => (
        <li key={notice.kind} className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="leading-5">
            <strong>{notice.label}</strong> («Servicio de interés contiene»): <UsageLinks usage={notice} serviceName={serviceName} />. {notice.detail}
          </p>
        </li>
      ))}
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
  const usages = usage.data?.usages ?? []
  const notices = usage.data?.notices ?? []
  const inUse = usages.length > 0

  function handleDelete() {
    deleteService.mutate(service.id, {
      onSuccess: () => toast.success(`"${service.name}" eliminado`),
      onError: err => toast.error(extractErrorMessage(err), { duration: 8000 }),
    })
  }

  let description = notices.length > 0
    ? 'Se puede eliminar: se borra junto con sus paquetes y no se puede deshacer. Antes, mira qué pasa con estas automatizaciones.'
    : 'Nadie lo usa: se borra junto con sus paquetes y no se puede deshacer.'
  let details = null
  if (usage.isPending) {
    description = 'Revisando dónde se usa…'
    details = <Loader2 className="mt-3 h-4 w-4 animate-spin text-wa-muted" aria-hidden="true" />
  } else if (usage.isError) {
    description = `No se pudo revisar dónde se usa (${extractErrorMessage(usage.error)}). Si lo usa algo, no se va a eliminar.`
  } else if (inUse) {
    description = 'No se puede eliminar porque está en uso. Quítalo de cada lugar (por ejemplo, cambia el servicio de interés del lead) o desactívalo: deja de ofrecerse y el historial se conserva.'
    const leads = usages.find(group => group.kind === 'leads')
    // El atajo va arriba y fuera de la lista: dentro de ella quedaba debajo de
    // los nombres, oculto en el scroll justo cuando más hace falta (92 leads).
    details = (
      <>
        {leads && <ReassignServiceLeads serviceName={service.name} leadCount={leads.count} />}
        <UsageList usages={usages} serviceName={service.name} />
        {notices.length > 0 && <NoticeList notices={notices} serviceName={service.name} />}
      </>
    )
  } else if (notices.length > 0) {
    details = <NoticeList notices={notices} serviceName={service.name} />
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
