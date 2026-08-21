import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import client from '../api/client'

// Función y no una constante de módulo: así los tests pueden simular
// navegadores con/sin soporte de Push sin tener que reimportar el módulo.
function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

interface VapidPublicKeyResponse {
  public_key: string
}

/** Convierte la clave pública VAPID (base64url) al `Uint8Array` que pide
 *  `PushManager.subscribe`. Conversión estándar: hay que rellenar el padding
 *  `=` que el base64url omite y cambiar `-_` por `+/` antes de decodificar. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  // `new Uint8Array(new ArrayBuffer(n))` en vez de `new Uint8Array(n)`: la
  // firma corta puede tipar el buffer como `ArrayBufferLike` (que incluye
  // `SharedArrayBuffer`), y `applicationServerKey` exige `ArrayBuffer` real.
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

async function fetchVapidPublicKey(): Promise<string> {
  const { data } = await client.get<VapidPublicKeyResponse>('/api/push/vapid-public-key')
  return data.public_key
}

function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  }
}

/** Suscripción a Web Push, para que los avisos que hoy solo llegan por
 *  WebSocket (reportes de incidencias, menciones) también aparezcan como
 *  notificación del sistema con la app cerrada. Se degrada con gracia en
 *  navegadores/contextos sin soporte de Push. */
export function usePushSubscription() {
  const [subscribed, setSubscribed] = useState(false)

  const { data: vapidPublicKey } = useQuery({
    queryKey: ['push', 'vapid-public-key'],
    queryFn: fetchVapidPublicKey,
    enabled: isPushSupported(),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!isPushSupported()) return
    let cancelled = false
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setSubscribed(subscription !== null)
      })
      .catch(() => {
        if (!cancelled) setSubscribed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const subscribe = useCallback(async () => {
    if (!isPushSupported() || !vapidPublicKey) return
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
    await client.post('/api/push/subscribe', subscriptionPayload(subscription))
    setSubscribed(true)
  }, [vapidPublicKey])

  const unsubscribe = useCallback(async () => {
    if (!isPushSupported()) return
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      setSubscribed(false)
      return
    }
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    await client.post('/api/push/unsubscribe', { endpoint })
    setSubscribed(false)
  }, [])

  return { subscribed, subscribe, unsubscribe }
}
