import { ArchiveRestore, ArchiveX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useDismissAppointment, useRestoreAppointment, type AppointmentListItem } from '../queries'

const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-wa-muted hover:bg-wa-field hover:text-wa-text disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-wa-field-dark dark:hover:text-wa-text-dark'

/** Desestimar una cita la saca de las cifras (citas, separaciones, adelantos)
 *  sin borrarla: los avisos ya salieron y queda el rastro de quién y por qué.
 *  Existe para las pruebas que tuvieron que hacerse en modo real porque el
 *  modo prueba no corre el flujo completo (p. ej. el evento a Meta). */
export function AppointmentDismissAction({ item }: { item: AppointmentListItem }) {
  const [reason, setReason] = useState('')
  const dismiss = useDismissAppointment()
  const restore = useRestoreAppointment()

  if (item.dismissed_at) {
    return (
      <button
        type="button"
        onClick={() => restore.mutate(item.id, {
          onSuccess: () => toast.success('La cita vuelve a contar en el panel'),
          onError: error => toast.error(extractErrorMessage(error)),
        })}
        disabled={restore.isPending}
        className={ACTION_CLASS}
      >
        <ArchiveRestore className="h-3.5 w-3.5" /> Restaurar
      </button>
    )
  }

  return (
    <ConfirmDialog
      title="Desestimar cita"
      description={`La cita de ${item.nombre_completo} deja de contar como cita y como ingreso en el panel y en las exportaciones de ventas. No se borra: puedes restaurarla después. Los avisos que ya salieron y el evento del calendario no cambian.`}
      confirmLabel="Desestimar"
      confirmDisabled={dismiss.isPending}
      onOpenChange={open => { if (!open) setReason('') }}
      details={(
        <label className="mt-4 block text-sm">
          <span className="font-medium">Motivo (opcional)</span>
          <textarea
            value={reason}
            onChange={event => setReason(event.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Ej.: prueba del permiso de eventos de Meta"
            className="mt-1 w-full resize-none rounded-lg border border-wa-border bg-white px-3 py-2 text-sm outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-field-dark"
          />
        </label>
      )}
      onConfirm={() => dismiss.mutate({ id: item.id, reason }, {
        onSuccess: () => toast.success('Cita desestimada'),
        onError: error => toast.error(extractErrorMessage(error)),
      })}
    >
      <button type="button" className={ACTION_CLASS}>
        <ArchiveX className="h-3.5 w-3.5" /> Desestimar
      </button>
    </ConfirmDialog>
  )
}
