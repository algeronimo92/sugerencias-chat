import { useEffect, useRef, useState } from 'react'
import type { MetaEmbeddedSignupPayload, MetaSignupMode } from '../types'
import { useFacebookSdk } from './useFacebookSdk'
import { useMetaPublicConfig } from './useSettings'

// Compatibilidad de despliegue durante la migración al panel global. Los
// valores del backend ganan; estas variables se pueden retirar cuando la
// configuración de plataforma ya esté cargada.
const LEGACY_META_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined
const LEGACY_META_CONFIG_ID = import.meta.env.VITE_FACEBOOK_CONFIG_ID as string | undefined

interface EmbeddedSignupData {
  phone_number_id?: string
  waba_id?: string
}

/** Cómo quedó el número según el evento de Meta: el de la app del celular
 *  (coexistencia) ya está registrado; el otro queda solo en la API y el
 *  backend tiene que registrarlo. */
const MODE_BY_EVENT: Record<string, MetaSignupMode> = {
  FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING: 'business_app',
  FINISH: 'cloud_api',
}

function isEmbeddedSignupMessage(
  data: unknown,
): data is { type: string; event: string; data?: EmbeddedSignupData } {
  return (
    typeof data === 'object'
    && data !== null
    && (data as { type?: unknown }).type === 'WA_EMBEDDED_SIGNUP'
  )
}

const CANCELLED = 'Se canceló la vinculación con Meta.'

/**
 * El Embedded Signup de Meta. Con la opción de coexistencia, la ventana de
 * Meta ofrece los dos caminos (como en ManyChat): conectar el número que ya
 * está en la app de WhatsApp Business sin sacarlo del celular, o elegir una
 * cuenta y escribir un número que queda solo en la API. Junta el `code` de
 * FB.login() y el {waba_id, phone_number_id} del postMessage de Meta, que
 * llegan por separado y en cualquier orden, y se los pasa a `onComplete`
 * junto con el modo en que quedó el número. Quien lo usa decide qué hace el backend con ese número: el
 * del CRM o el de avisos de cita.
 */
export function useMetaEmbeddedSignup(onComplete: (payload: MetaEmbeddedSignupPayload) => void) {
  const { data: metaConfig, isLoading } = useMetaPublicConfig()
  const appId = metaConfig?.app_id || LEGACY_META_APP_ID
  const configId = metaConfig?.config_id || LEGACY_META_CONFIG_ID
  // El SDK se inicializa una sola vez por página: esperar al backend evita
  // que quede atado al app id de respaldo mientras la consulta sigue en vuelo.
  const sdkReady = useFacebookSdk(isLoading ? undefined : appId)
  const [error, setError] = useState<string | null>(null)
  const pendingCode = useRef<string | null>(null)
  const pendingData = useRef<EmbeddedSignupData | null>(null)
  const pendingMode = useRef<MetaSignupMode>('business_app')
  // Solo escucha la ventana de Meta la instancia que abrió el login: hay dos
  // botones en la misma página (el del CRM y el de avisos) y cada uno guarda
  // el número en un lugar distinto.
  const started = useRef(false)
  const completeRef = useRef(onComplete)
  // Se actualiza después del render: render tiene que ser puro (React puede
  // repetirlo o descartarlo) y el callback solo se llama desde eventos.
  useEffect(() => {
    completeRef.current = onComplete
  })

  function trySubmit() {
    const code = pendingCode.current
    const data = pendingData.current
    // El phone_number_id es opcional: el evento de coexistencia
    // (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) no lo manda y el backend lo
    // resuelve a partir de la WABA.
    if (!code || !data?.waba_id) return
    pendingCode.current = null
    pendingData.current = null
    started.current = false
    setError(null)
    completeRef.current({ code, waba_id: data.waba_id, phone_number_id: data.phone_number_id, mode: pendingMode.current })
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
      if (!started.current) return
      let payload: unknown
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!isEmbeddedSignupMessage(payload)) return
      // 'FINISH' es el signup normal (número solo en la API); en coexistencia
      // con la app de WhatsApp Business el evento es distinto y su payload
      // trae solo waba_id.
      const mode = MODE_BY_EVENT[payload.event]
      if (mode && payload.data) {
        pendingMode.current = mode
        pendingData.current = payload.data
        trySubmit()
      } else if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
        started.current = false
        setError(CANCELLED)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** ``preferred`` es lo que la clínica eligió antes de abrir Meta: con
   *  ``business_app`` la ventana ofrece conectar la app del celular; con
   *  ``cloud_api`` va directo a elegir cuenta y número. Lo que manda al
   *  backend es lo que Meta informó al terminar, no esta elección. */
  function start(preferred: MetaSignupMode = 'business_app') {
    if (!window.FB || !configId) return
    setError(null)
    pendingCode.current = null
    pendingData.current = null
    started.current = true
    window.FB.login(
      response => {
        const code = response.authResponse?.code
        if (!code) {
          if (response.status !== 'connected') {
            started.current = false
            setError(CANCELLED)
          }
          return
        }
        pendingCode.current = code
        trySubmit()
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          // Agrega la opción de la app del celular; no quita la de un número
          // solo para la API (doc de Meta, "Onboarding WhatsApp Business app users").
          ...(preferred === 'business_app' ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
          sessionInfoVersion: '3',
        },
      },
    )
  }

  return {
    loading: isLoading,
    configured: Boolean(appId && configId),
    ready: sdkReady,
    start,
    error,
    setError,
  }
}
