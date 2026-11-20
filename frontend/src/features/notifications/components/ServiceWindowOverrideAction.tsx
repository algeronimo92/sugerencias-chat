import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { SERVICE_WINDOW_ERROR_CODE } from '../../automations/public/automationCatalog'
import { useAutomationExecution, useRetryExecution } from '../../automations/public/queries'
import type { UserNotification } from '../types'

/** Id de la ejecución que hay que reintentar, solo si la notificación es un
 *  fallo por la ventana de 24 h cerrada. null en cualquier otro aviso. */
function serviceWindowExecutionId(notification: UserNotification): number | null {
  const metadata = notification.metadata
  if (!metadata || metadata.error_code !== SERVICE_WINDOW_ERROR_CODE) return null
  const executionId = metadata.automation_execution_id
  return typeof executionId === 'number' ? executionId : null
}

/** Autorización del admin, en la alerta misma: la automatización no pudo
 *  escribirle al cliente porque hacía más de 24 h que no respondía, y desde
 *  acá se la habilita a salir igual. El permiso es de esta ejecución sola y el
 *  backend guarda quién lo dio. */
export function ServiceWindowOverrideAction({ notification, isAdmin }: { notification: UserNotification; isAdmin: boolean }) {
  const retryExecution = useRetryExecution()
  const executionId = serviceWindowExecutionId(notification)
  // Se consulta la ejecución en sí (no la notificación, que es una foto
  // fija) porque ahí es donde el backend guarda quién autorizó saltarse la
  // ventana. Así el botón no "olvida" la autorización al recargar la página.
  const { data: execution } = useAutomationExecution(isAdmin ? executionId : null)
  if (!isAdmin || executionId === null) return null

  if (execution?.window_override_at) {
    return (
      <p className="flex items-center gap-1.5 px-4 pb-3 pl-16 text-[10px] font-medium text-wa-primary-strong dark:text-wa-primary">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Autorizada por {execution.window_override_by_name ?? 'un admin'}: se reintenta ignorando la ventana
      </p>
    )
  }
  return (
    <div className="px-4 pb-3 pl-16">
      <Button
        variant="secondary"
        size="sm"
        disabled={retryExecution.isPending}
        onClick={() => retryExecution.mutate(
          { id: executionId, ignoreServiceWindow: true },
          {
            onSuccess: () => toast.success('Automatización reprogramada con tu autorización'),
            onError: reason => toast.error(extractErrorMessage(reason)),
          },
        )}
        className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
      >
        {retryExecution.isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
        Autorizar y reintentar
      </Button>
      <p className="mt-1 text-[10px] text-wa-muted">Envía aunque la ventana de 24 h esté cerrada. Solo para esta ejecución.</p>
    </div>
  )
}
