import { useEffect } from 'react'
import { Loader2, X } from 'lucide-react'
import { MapPreview } from './MapPreview'

interface Props {
  latitude: number
  longitude: number
  isSending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function LocationConfirmDialog({ latitude, longitude, isSending, onConfirm, onCancel }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="w-full max-w-xs bg-white dark:bg-wa-panel-dark rounded-xl shadow-xl border border-wa-border dark:border-wa-border-dark overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-wa-border dark:border-wa-border-dark">
          <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Enviar tu ubicación actual</p>
          <button
            onClick={onCancel}
            aria-label="Cerrar"
            className="text-wa-muted hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <MapPreview latitude={latitude} longitude={longitude} />

        <div className="flex border-t border-wa-border dark:border-wa-border-dark">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-wa-hover dark:hover:bg-wa-head-dark transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isSending}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 border-l border-wa-border dark:border-wa-border-dark"
          >
            {isSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enviar ubicación
          </button>
        </div>
      </div>
    </div>
  )
}
