import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Link2, Loader2 } from 'lucide-react'
import { useCompleteMetaEmbeddedSignup } from '../hooks/useSettings'
import { useFacebookSdk } from '../hooks/useFacebookSdk'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
interface Props {
  onGoToClaves: () => void
}

const META_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined
const META_CONFIG_ID = import.meta.env.VITE_FACEBOOK_CONFIG_ID as string | undefined

interface EmbeddedSignupData {
  phone_number_id?: string
  waba_id?: string
}

function isEmbeddedSignupMessage(data: unknown): data is { type: string; event: string; data?: EmbeddedSignupData } {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'WA_EMBEDDED_SIGNUP'
}

// Panel de coexistencia con Meta (WhatsApp Embedded Signup): vincula un
// número que ya está activo en la app oficial de WhatsApp Business sin
// desconectarlo de ahí. Completa las mismas credenciales que se pueden
// tipear a mano en la pestaña Claves (meta_access_token/waba_id/phone_number_id).
function MetaEmbeddedSignupPanel() {
  const sdkReady = useFacebookSdk(META_APP_ID)
  const { mutate: complete, isPending } = useCompleteMetaEmbeddedSignup()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  // El `code` de FB.login() y el {waba_id, phone_number_id} del postMessage
  // de Meta llegan por separado y en cualquier orden; se juntan acá antes de
  // mandarlos al backend.
  const pendingCode = useRef<string | null>(null)
  const pendingSignupData = useRef<EmbeddedSignupData | null>(null)

  function trySubmit() {
    const code = pendingCode.current
    const data = pendingSignupData.current
    // El phone_number_id es opcional: el evento de coexistencia
    // (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) no lo manda -- el backend lo
    // resuelve solo a partir de la WABA (ver meta_service.py).
    if (!code || !data?.waba_id) return
    pendingCode.current = null
    pendingSignupData.current = null
    setError(null)
    complete(
      { code, waba_id: data.waba_id, phone_number_id: data.phone_number_id },
      {
        onSuccess: () => {
          setSuccess(true)
          toast.success('WhatsApp vinculado con Meta')
        },
        onError: (err) => setError(extractErrorMessage(err)),
      }
    )
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return
      let payload: unknown
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!isEmbeddedSignupMessage(payload)) return
      // 'FINISH' es el signup normal (WABA + número nuevo); en coexistencia
      // con la app de WhatsApp Business el evento es distinto y su payload
      // trae solo waba_id -- ver docs de Meta sobre Embedded Signup.
      if ((payload.event === 'FINISH' || payload.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') && payload.data) {
        pendingSignupData.current = payload.data
        trySubmit()
      } else if (payload.event === 'CANCEL' || payload.event === 'ERROR') {
        setError('Se canceló la vinculación con Meta.')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLogin() {
    if (!window.FB || !META_CONFIG_ID) return
    setError(null)
    setSuccess(false)
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code
        if (!code) {
          if (response.status !== 'connected') setError('Se canceló la vinculación con Meta.')
          return
        }
        pendingCode.current = code
        trySubmit()
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
      }
    )
  }

  if (!META_APP_ID || !META_CONFIG_ID) return null

  return (
    <div className="space-y-2 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark">
      <div className="flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
        <Link2 className="h-4 w-4" />
        Coexistencia con Meta
      </div>
      <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
        Vinculá un número que ya usás en la app oficial de WhatsApp Business sin
        desconectarlo de ahí. Reemplaza tener que copiar el token, el WABA id y el
        phone number id a mano en la pestaña Claves.
      </p>
      <Button onClick={handleLogin} disabled={!sdkReady || isPending} variant="ghost">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
        Vincular con Meta
      </Button>
      {success && (
        <p className="flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> Credenciales guardadas en la pestaña Claves.
        </p>
      )}
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  )
}

export function WhatsappPanel({ onGoToClaves }: Props) {
  return (
    <div className="space-y-4">
      <MetaEmbeddedSignupPanel />
      <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
        También podés completar el token, el WABA id y el phone number id a mano en{' '}
        <button type="button" onClick={onGoToClaves} className="font-medium text-wa-primary-strong underline dark:text-wa-primary">
          la pestaña Claves
        </button>
        .
      </p>
    </div>
  )
}
