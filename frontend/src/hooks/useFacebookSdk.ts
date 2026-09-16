import { useEffect, useState } from 'react'

declare global {
  interface Window {
    fbAsyncInit?: () => void
    FB?: {
      init: (params: { appId: string; xfbml: boolean; version: string }) => void
      login: (
        callback: (response: { authResponse: { code?: string } | null; status: string }) => void,
        params: {
          config_id: string
          response_type: 'code'
          override_default_response_type: true
          extras: { setup: Record<string, unknown>; featureType: string; sessionInfoVersion: string }
        }
      ) => void
    }
  }
}

const SDK_SCRIPT_ID = 'facebook-jssdk'
const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'
const GRAPH_API_VERSION = 'v26.0'

// El SDK de Facebook solo lo necesita este panel (vincular WhatsApp vía
// Embedded Signup) — se carga bajo demanda acá en vez de en index.html para
// no pedirle ese script a cada usuario en cada carga de la app.
export function useFacebookSdk(appId: string | undefined) {
  const [ready, setReady] = useState(() => Boolean(window.FB))

  useEffect(() => {
    if (!appId || window.FB) {
      if (window.FB) setReady(true)
      return
    }

    window.fbAsyncInit = () => {
      window.FB?.init({ appId, xfbml: true, version: GRAPH_API_VERSION })
      setReady(true)
    }

    if (document.getElementById(SDK_SCRIPT_ID)) return

    const script = document.createElement('script')
    script.id = SDK_SCRIPT_ID
    script.src = SDK_URL
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    document.body.appendChild(script)
  }, [appId])

  return ready
}
