import { BellOff, BellRing } from 'lucide-react'
import type { NotificationPermissionState } from '../hooks/useNotifications'

interface Props {
  browserPermission: NotificationPermissionState
  onRequestBrowserPermission: () => void
}

/** Pie del centro de notificaciones: estado de los avisos del navegador y,
 * si todavía no se decidió, el botón para pedir el permiso. */
export function BrowserPermissionFooter({ browserPermission, onRequestBrowserPermission }: Props) {
  return (
    <footer className="border-t border-wa-border bg-wa-hover px-4 py-2.5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      {browserPermission === 'default' && (
        <button type="button" onClick={onRequestBrowserPermission} className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-wa-primary-strong hover:text-green-800 dark:text-wa-primary"><BellRing className="h-3.5 w-3.5" /> Activar también avisos del navegador</button>
      )}
      {browserPermission === 'granted' && <p className="flex items-center justify-center gap-1.5 text-[10px] text-wa-primary-strong dark:text-wa-primary"><BellRing className="h-3.5 w-3.5" /> Avisos del navegador activados</p>}
      {browserPermission === 'denied' && <p className="flex items-center justify-center gap-1.5 text-[10px] text-wa-muted"><BellOff className="h-3.5 w-3.5" /> Avisos bloqueados por el navegador</p>}
      {browserPermission === 'unsupported' && <p className="text-center text-[10px] text-wa-muted">Este navegador no admite avisos de escritorio</p>}
    </footer>
  )
}
