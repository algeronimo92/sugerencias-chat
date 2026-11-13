import { CheckCircle2, ChevronDown, Loader2, Mail, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { IntegrationCard, type IntegrationState } from '../../../shared/ui/IntegrationCard'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
  useClearEmailSettings,
  useEmailSettings,
  useSendEmailTest,
  type EmailSettingsStatus,
} from '../hooks/useEmailSettings'
import { EmailConnectCard } from './EmailConnectCard'
import { EmailSmtpForm } from './EmailSmtpForm'

const cardClass = 'space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark'
const hintClass = 'text-[11px] text-wa-muted dark:text-wa-muted-dark'
const errorClass = 'text-xs text-red-500 dark:text-red-400'

function stateOf(status: EmailSettingsStatus | undefined, failed: boolean): { state: IntegrationState; label?: string } {
  if (failed) return { state: 'error' }
  if (status?.configured) return { state: 'connected' }
  if (status?.platform_available) return { state: 'unconfigured', label: 'Usa el de la plataforma' }
  return { state: 'unconfigured' }
}

// El correo desde el que salen las invitaciones y avisos del negocio: una
// cuenta conectada con un clic o un SMTP. Sin ninguno se usa el de la
// plataforma, que no lleva el dominio del negocio. Vive en Integraciones
// junto a las otras cuentas externas del negocio, no en Configuración.
export function EmailIntegrationCard() {
  const { data: status, isLoading, error } = useEmailSettings()
  const { state, label } = stateOf(status, Boolean(error))

  return (
    <IntegrationCard
      id="correo"
      icon={Mail}
      title="Correo de envío"
      state={state}
      stateLabel={label}
    >
      {isLoading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-wa-muted dark:text-wa-muted-dark" aria-label="Cargando" />
        </div>
      )}
      {!isLoading && (error || !status) && (
        <p className={errorClass} role="alert">No se pudo cargar la configuración de correo.</p>
      )}
      {status && <EmailSettingsView status={status} />}
    </IntegrationCard>
  )
}

function EmailSettingsView({ status }: { status: EmailSettingsStatus }) {
  const clear = useClearEmailSettings()
  const test = useSendEmailTest()
  // El SMTP queda plegado cuando hay botones de conexión: es el camino
  // secundario (Hostinger, dominio propio sin OAuth, contraseña de aplicación).
  const [smtpOpen, setSmtpOpen] = useState(status.mode === 'smtp' || status.oauth_available.length === 0)
  const canTest = status.configured || status.platform_available

  return (
    <div className="space-y-4">
      <StatusNote status={status} />

      <EmailConnectCard status={status} />

      <div className={cardClass}>
        <button
          type="button"
          onClick={() => setSmtpOpen((open) => !open)}
          aria-expanded={smtpOpen}
          className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-wa-text dark:text-wa-text-dark"
        >
          {status.oauth_available.length > 0 ? 'Otro proveedor (SMTP)' : 'Configurar con SMTP'}
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${smtpOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {smtpOpen && <EmailSmtpForm key={`${status.mode}-${status.host}`} status={status} />}
      </div>

      {canTest && (
        <div className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={hintClass}>Te enviamos un correo de prueba a tu cuenta para comprobar que todo funciona.</p>
            <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Enviar prueba
            </Button>
          </div>
          {test.isSuccess && (
            <p className="flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary" role="status">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Enviado a {test.data.recipient}. Revisa también la carpeta de spam.
            </p>
          )}
          {test.isError && <p className={errorClass} role="alert">{extractErrorMessage(test.error)}</p>}
        </div>
      )}

      {status.mode === 'smtp' && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
            {clear.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Quitar SMTP y volver al correo de la plataforma
          </Button>
        </div>
      )}
      {clear.isError && <p className={errorClass} role="alert">{extractErrorMessage(clear.error)}</p>}
    </div>
  )
}

function StatusNote({ status }: { status: EmailSettingsStatus }) {
  if (status.configured) {
    const from = status.mode === 'oauth' ? status.oauth_account_email : status.from_address
    return (
      <p className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-2 text-[11px] text-wa-primary-strong dark:border-green-900/60 dark:bg-green-950/20 dark:text-wa-primary">
        Se envía desde {from}.
      </p>
    )
  }
  if (status.platform_available) {
    return (
      <p className="rounded-lg border border-wa-border bg-wa-hover px-3 py-2 text-[11px] text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark">
        Por ahora se envía desde el correo de la plataforma. Conecta el tuyo para que tu equipo reciba las invitaciones
        desde tu negocio.
      </p>
    )
  }
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
      Todavía no hay correo de envío: hasta conectar uno no se pueden mandar invitaciones.
    </p>
  )
}
