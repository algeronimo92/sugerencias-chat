import { CirclePause } from 'lucide-react'
import { Button } from '../../../../shared/ui/Button'
import { Modal } from '../../../../shared/ui/Modal'

/**
 * Publicar activa el flujo. Si estaba pausado a propósito, antes se
 * reactivaba sin avisar: ahora se pregunta. La primera publicación no pasa
 * por acá (un flujo nuevo nace pausado y publicarlo es activarlo).
 */
export function PublishPausedDialog({ open, onResume, onKeepPaused, onCancel }: {
  open: boolean
  onResume: () => void
  onKeepPaused: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Modal
      alert
      layer="confirm"
      title="Este flujo está pausado"
      description="¿Lo reanudas al publicar? Si sigue pausado, no entra ningún lead nuevo hasta que lo reanudes."
      icon={<CirclePause className="h-4 w-4" />}
      onClose={onCancel}
      footer={<>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="secondary" onClick={onKeepPaused}>Publicar y dejarlo pausado</Button>
        <Button onClick={onResume}>Publicar y reanudar</Button>
      </>}
    >
      <p className="text-sm leading-relaxed text-wa-muted dark:text-wa-muted-dark">
        Los leads que ya están dentro terminan con la versión con la que entraron.
      </p>
    </Modal>
  )
}
