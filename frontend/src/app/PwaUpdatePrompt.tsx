import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'
import { currentBrandName } from '../shared/branding'
import {
  registerPwaUpdater,
  setPwaUpdatePending,
  usePwaCurrentChatId,
} from '../shared/pwaUpdate'
import { useChatSocketConnected } from '../realtime/useRealtime'

// Id fijo para que el aviso no se apile si el efecto vuelve a correr.
const UPDATE_TOAST_ID = 'pwa-update'

// El CRM se deja abierto todo el día en una pestaña. Sin este sondeo el
// navegador solo buscaría una versión nueva al recargar, y un vendedor que
// nunca cierra la app se quedaría semanas con el build viejo.
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

// Además del sondeo horario se comprueba al volver a la pestaña y al
// reconectar el WebSocket, que es justo lo que pasa tras un despliegue. Pero
// el socket reconecta cada 3 s y un deploy produce reconexiones en ráfaga:
// este tope evita pedir sw.js decenas de veces en un minuto.
export const MIN_UPDATE_CHECK_GAP_MS = 5 * 60 * 1000

// Marca que sobrevive a la recarga para poder decir en consola que el build
// que acaba de cargar es el resultado de aplicar una actualización.
const UPDATE_APPLIED_KEY = 'pwa-update-applied'

function rememberUpdateApplied() {
  try {
    sessionStorage.setItem(UPDATE_APPLIED_KEY, '1')
  } catch {
    // Sin sessionStorage (modo privado estricto) solo se pierde el log.
  }
}

function consumeUpdateApplied() {
  try {
    const applied = sessionStorage.getItem(UPDATE_APPLIED_KEY) === '1'
    if (applied) sessionStorage.removeItem(UPDATE_APPLIED_KEY)
    return applied
  } catch {
    return false
  }
}

/**
 * Registra el service worker, busca versiones nuevas y avisa cuando hay una.
 *
 * No recarga solo a propósito: hacerlo mientras alguien escribe un mensaje o
 * graba un audio le borraría el trabajo. El usuario elige el momento. Lo que
 * sí hace es no dejar que el aviso se pierda: descartarlo lo esconde hasta que
 * la persona vuelve a la pestaña o cambia de chat, y la cabecera lo muestra
 * fijo mientras tanto. El 2026-11-09 una pestaña siguió sirviendo el build
 * anterior con el worker nuevo en `waiting` porque el único aviso era un
 * toast descartable que no volvía hasta el siguiente sondeo.
 */
export function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const lastCheckAtRef = useRef(0)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_swUrl, swRegistration) => {
      // Registrar ya comprueba si hay versión nueva: la cuenta como la
      // última comprobación para no repetirla al primer evento.
      lastCheckAtRef.current = Date.now()
      setRegistration(swRegistration ?? null)
      if (consumeUpdateApplied()) console.info(`${currentBrandName()}: versión nueva aplicada, build ${__APP_BUILD__}`)
      else console.info(`${currentBrandName()}: build ${__APP_BUILD__}`)
    },
  })

  const checkForUpdate = useCallback(() => {
    if (!registration) return
    const now = Date.now()
    if (now - lastCheckAtRef.current < MIN_UPDATE_CHECK_GAP_MS) return
    lastCheckAtRef.current = now
    void registration.update().catch(() => {
      // Sin red no hay sw.js que comparar; el siguiente evento lo reintenta.
    })
  }, [registration])

  const applyUpdate = useCallback(() => {
    rememberUpdateApplied()
    // `true` recarga la página una vez que el worker nuevo toma el control.
    void updateServiceWorker(true)
  }, [updateServiceWorker])

  const offerUpdate = useCallback(() => {
    toast(`Hay una versión nueva de ${currentBrandName()}`, {
      id: UPDATE_TOAST_ID,
      description: 'Actualiza para aplicar los cambios.',
      duration: Infinity,
      action: { label: 'Actualizar', onClick: applyUpdate },
      // "Ahora no" solo esconde el aviso. El build sigue pendiente (lo dice
      // el chip de la cabecera) y el toast vuelve al volver a la pestaña o al
      // cambiar de chat.
      cancel: { label: 'Ahora no', onClick: () => {} },
    })
  }, [applyUpdate])

  // Sondeo horario.
  useEffect(() => {
    if (!registration) return
    const intervalId = window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [registration, checkForUpdate])

  // Al volver a primer plano: se busca versión nueva y, si ya hay una
  // pendiente, se vuelve a ofrecer. Como Effect Event, el handler ve siempre
  // el estado vigente sin que el listener tenga que reinscribirse cada vez
  // que cambia un callback.
  const onBackToForeground = useEffectEvent(() => {
    checkForUpdate()
    if (needRefresh) offerUpdate()
  })
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') onBackToForeground()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Al pasar de desconectado a conectado. Un despliegue tira el socket y lo
  // vuelve a levantar: es el mejor momento para enterarse del build nuevo.
  const socketConnected = useChatSocketConnected()
  const wasConnectedRef = useRef(socketConnected)
  useEffect(() => {
    if (socketConnected && !wasConnectedRef.current) checkForUpdate()
    wasConnectedRef.current = socketConnected
  }, [socketConnected, checkForUpdate])

  // Estado compartido con la cabecera (chip) y cómo aplicar la actualización.
  useEffect(() => {
    setPwaUpdatePending(needRefresh)
    registerPwaUpdater(needRefresh ? applyUpdate : null)
    return () => registerPwaUpdater(null)
  }, [needRefresh, applyUpdate])

  // Primera oferta cuando aparece el build nuevo, y de nuevo en cada cambio
  // de chat mientras siga pendiente. `toast` con el mismo id actualiza el
  // aviso si está en pantalla y lo vuelve a mostrar si se había descartado.
  const chatId = usePwaCurrentChatId()
  useEffect(() => {
    if (!needRefresh) return
    offerUpdate()
  }, [needRefresh, chatId, offerUpdate])

  useEffect(() => {
    if (!needRefresh) toast.dismiss(UPDATE_TOAST_ID)
  }, [needRefresh])

  return null
}
