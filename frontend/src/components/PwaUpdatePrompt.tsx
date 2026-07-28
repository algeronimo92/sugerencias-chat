import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'

// Id fijo para que el aviso no se apile si el efecto vuelve a correr.
const UPDATE_TOAST_ID = 'pwa-update'

// El CRM se deja abierto todo el día en una pestaña. Sin este sondeo el
// navegador solo buscaría una versión nueva al recargar, y un vendedor que
// nunca cierra la app se quedaría semanas con el build viejo.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Registra el service worker y avisa cuando hay un build nuevo.
 *
 * No recarga solo a propósito: hacerlo mientras alguien escribe un mensaje o
 * graba un audio le borraría el trabajo. El usuario elige el momento.
 */
export function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_swUrl, swRegistration) => setRegistration(swRegistration ?? null),
  })

  useEffect(() => {
    if (!registration) return
    const intervalId = window.setInterval(() => {
      void registration.update()
    }, UPDATE_CHECK_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [registration])

  useEffect(() => {
    if (!needRefresh) return
    toast('Hay una versión nueva de DermicaPro', {
      id: UPDATE_TOAST_ID,
      description: 'Actualizá para aplicar los cambios.',
      duration: Infinity,
      action: {
        label: 'Actualizar',
        // `true` recarga la página una vez que el worker nuevo toma el control.
        onClick: () => void updateServiceWorker(true),
      },
      // Descartarlo no pierde la actualización: se aplica sola en la próxima
      // recarga, y el sondeo volverá a ofrecerla si sigue pendiente.
      onDismiss: () => setNeedRefresh(false),
    })
  }, [needRefresh, setNeedRefresh, updateServiceWorker])

  return null
}
