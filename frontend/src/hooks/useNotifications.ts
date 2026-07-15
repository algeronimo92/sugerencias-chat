import { useCallback, useEffect, useState } from 'react'

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'
export interface NotificationOptions { force?: boolean; tag?: string }

const BASE_TITLE = document.title

function currentPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/** Notificaciones de escritorio + contador persistente de chats no leídos
 * en el título. El total viene de la DB y no se borra al enfocar la ventana. */
export function useNotifications(unreadCount: number) {
  const [permission, setPermission] = useState<NotificationPermissionState>(currentPermission)

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [unreadCount])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return
    const result = await Notification.requestPermission()
    setPermission(result)
  }, [])

  const notify = useCallback(
    (title: string, body: string, onClick: () => void, options?: NotificationOptions) => {
      // El aviso de escritorio solo hace falta fuera de foco. El contador del
      // título es independiente y permanece sincronizado con la DB.
      const isBackground = document.hidden || !document.hasFocus()
      if (!isBackground && !options?.force) return

      if (permission !== 'granted') return

      // tag fijo: si llegan varias seguidas, la última reemplaza a la
      // anterior en vez de apilar notificaciones.
      const n = new Notification(title, { body, icon: '/favicon.svg', tag: options?.tag ?? 'wsp-nuevo-mensaje' })
      n.onclick = () => {
        window.focus()
        onClick()
        n.close()
      }
    },
    [permission]
  )

  return { permission, requestPermission, notify }
}
