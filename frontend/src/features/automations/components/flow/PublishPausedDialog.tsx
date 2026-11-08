import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Button } from '../../../../shared/ui/Button'

/**
 * Publicar activa el flujo. Si estaba pausado a propósito, antes se
 * reactivaba sin avisar: ahora se pregunta. La primera publicación no pasa
 * por acá (un flujo nuevo nace pausado y publicarlo es activarlo).
 */
export function PublishPausedDialog({ open, version, onResume, onKeepPaused, onCancel }: {
  open: boolean
  /** La versión que está en uso hoy. */
  version: number
  onResume: () => void
  onKeepPaused: () => void
  onCancel: () => void
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={next => { if (!next) onCancel() }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-[1px]" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-wa-border bg-white p-5 text-wa-text shadow-2xl outline-none dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark">
          <AlertDialog.Title className="text-base font-semibold">Este flujo está pausado</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-wa-muted dark:text-wa-muted-dark">
            Al publicar, la versión nueva reemplaza a la v{version}. ¿Quieres que vuelva a funcionar o que siga pausado? Los leads que ya están dentro del flujo terminan con la versión con la que entraron.
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="ghost">Cancelar</Button></AlertDialog.Cancel>
            <Button variant="secondary" onClick={onKeepPaused}>Publicar y dejarlo pausado</Button>
            <Button variant="primary" onClick={onResume}>Publicar y reanudar</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
