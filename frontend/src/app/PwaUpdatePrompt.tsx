import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'
import { publishActivityLease } from '../shared/activity'
import { currentBrandName } from '../shared/branding'
import {
  registerPwaUpdater,
  setPwaUpdatePending,
  usePwaCurrentChatId,
} from '../shared/pwaUpdate'
import { useChatSocketConnected } from '../realtime/useRealtime'
import { usePendingSends } from '../features/chats/public/usePendingSends'
import { describeUpdateBlocker, updateBlocker } from './pwaUpdateGuard'

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

// Si el worker nuevo no toma el control en este tiempo, algo falló: se quita
// el velo de "Actualizando…" y se le pide a la persona que recargue a mano.
export const APPLY_TIMEOUT_MS = 15_000

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
 * Registra el service worker, busca versiones nuevas, avisa cuando hay una y
 * la aplica sola en el primer momento seguro.
 *
 * El momento es el cambio de chat: es la navegación que una vendedora hace
 * seguro en su jornada (casi nunca sale de /chat/*), y lo que tiene a medias
 * ya se terminó o se abandonó. "Seguro" lo decide `updateBlocker`: nada
 * grabándose, sin adjuntos pendientes ni envíos en vuelo, sin respuesta
 * citada ni selección, sin cambios sin guardar en el editor de flujos, sin
 * diálogo abierto y sin otra pestaña del CRM ocupada (aplicar el worker
 * recarga todas). El botón manual pasa por el mismo filtro y, si algo lo
 * frena, lo dice. Mientras se aplica hay un velo con texto visible; sin
 * cuenta atrás (WCAG 2.2.1).
 *
 * Si no se puede aplicar, el aviso no se pierde: descartarlo lo esconde hasta
 * que la persona vuelve a la pestaña o cambia de chat, y la cabecera lo
 * muestra fijo. El 2026-11-09 una pestaña siguió sirviendo el build anterior
 * con el worker nuevo en `waiting` porque el único aviso era un toast
 * descartable que no volvía hasta el siguiente sondeo.
 */
export function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [applying, setApplying] = useState(false)
  const lastCheckAtRef = useRef(0)
  const pendingSends = usePendingSends()

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

  /** Aplica la versión nueva si es seguro. Devuelve si lo hizo. */
  const tryApplyUpdate = useCallback((trigger: 'manual' | 'navigation') => {
    const blocker = updateBlocker({ pendingSends })
    if (blocker) {
      const reason = describeUpdateBlocker(blocker)
      if (trigger === 'manual') {
        toast.info('Todavía no se puede actualizar', { description: `Ahora mismo ${reason}. Termina eso y vuelve a intentarlo.` })
      } else {
        console.info(`${currentBrandName()}: versión nueva pendiente, no se aplica al cambiar de chat porque ${reason}`)
      }
      return false
    }
    toast.dismiss(UPDATE_TOAST_ID)
    setApplying(true)
    rememberUpdateApplied()
    // `true` recarga la página una vez que el worker nuevo toma el control.
    void updateServiceWorker(true)
    return true
  }, [pendingSends, updateServiceWorker])

  const offerUpdate = useCallback(() => {
    toast(`Hay una versión nueva de ${currentBrandName()}`, {
      id: UPDATE_TOAST_ID,
      description: 'Actualiza para aplicar los cambios.',
      duration: Infinity,
      action: { label: 'Actualizar', onClick: () => void tryApplyUpdate('manual') },
      // "Ahora no" solo esconde el aviso. El build sigue pendiente (lo dice
      // el chip de la cabecera) y el toast vuelve al volver a la pestaña o al
      // cambiar de chat.
      cancel: { label: 'Ahora no', onClick: () => {} },
    })
  }, [tryApplyUpdate])

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
    if (needRefresh && !applying) offerUpdate()
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

  // Las demás pestañas tienen que saber si esta tiene algo a medias.
  useEffect(() => publishActivityLease(), [])

  // Estado compartido con la cabecera (chip) y cómo aplicar la actualización.
  useEffect(() => {
    setPwaUpdatePending(needRefresh)
    registerPwaUpdater(needRefresh ? () => void tryApplyUpdate('manual') : null)
    return () => registerPwaUpdater(null)
  }, [needRefresh, tryApplyUpdate])

  // Cambio de chat con una versión ya pendiente: se aplica si es seguro; si
  // no, se vuelve a ofrecer. `armed` evita aplicar en el mismo render en que
  // aparece el build nuevo o justo al cargar la página en un chat.
  const chatId = usePwaCurrentChatId()
  const previousChatIdRef = useRef(chatId)
  const armedRef = useRef(false)
  useEffect(() => {
    const changed = previousChatIdRef.current !== chatId
    previousChatIdRef.current = chatId
    if (!needRefresh || applying) return
    if (changed && armedRef.current && tryApplyUpdate('navigation')) return
    // Primera oferta, o re-oferta al cambiar de chat. `toast` con el mismo
    // id actualiza el aviso si está en pantalla y lo vuelve a mostrar si se
    // había descartado.
    offerUpdate()
  }, [needRefresh, chatId, applying, tryApplyUpdate, offerUpdate])
  useEffect(() => {
    armedRef.current = needRefresh
  }, [needRefresh])

  useEffect(() => {
    if (!needRefresh) toast.dismiss(UPDATE_TOAST_ID)
  }, [needRefresh])

  // Si la recarga no llega, se suelta el velo y se avisa.
  useEffect(() => {
    if (!applying) return
    const timeoutId = window.setTimeout(() => {
      setApplying(false)
      toast.error('No se pudo aplicar la versión nueva', { description: 'Recarga la página para intentarlo de nuevo.' })
    }, APPLY_TIMEOUT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [applying])

  if (!applying) return null
  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-wa-app/80 backdrop-blur-sm dark:bg-wa-app-dark/80"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-wa-border bg-white px-5 py-4 text-sm font-medium text-wa-text shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark">
        <Loader2 className="h-5 w-5 animate-spin text-wa-primary" aria-hidden="true" />
        <span>Actualizando {currentBrandName()}…</span>
      </div>
    </div>
  )
}
