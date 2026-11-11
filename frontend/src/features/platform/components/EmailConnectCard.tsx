import { CheckCircle2, Link2, Loader2, Unlink } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
  useConnectEmail,
  useDisconnectEmail,
  type EmailOAuthProvider,
  type EmailSettingsStatus,
} from '../hooks/useEmailSettings'

const cardClass = 'space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark'
const titleClass = 'flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark'
const hintClass = 'text-[11px] text-wa-muted dark:text-wa-muted-dark'
const errorClass = 'text-xs text-red-500 dark:text-red-400'

const OAUTH_PROVIDERS: { id: EmailOAuthProvider; label: string; hint: string }[] = [
  { id: 'google', label: 'Google', hint: 'Gmail y Google Workspace' },
  { id: 'microsoft', label: 'Microsoft', hint: 'Outlook y Microsoft 365' },
  { id: 'zoho', label: 'Zoho', hint: 'Zoho Mail, también con dominio propio' },
]

// "Conectar con…": el admin autoriza su cuenta en el proveedor y vuelve al
// CRM. Sin contraseñas ni datos de servidor, igual que Google Calendar.
export function EmailConnectCard({ status }: { status: EmailSettingsStatus }) {
  const connect = useConnectEmail()
  const disconnect = useDisconnectEmail()
  const available = OAUTH_PROVIDERS.filter((p) => status.oauth_available.includes(p.id))

  if (status.mode === 'oauth' && status.oauth_provider) {
    const provider = OAUTH_PROVIDERS.find((p) => p.id === status.oauth_provider)
    return (
      <div className={cardClass}>
        <div className={titleClass}>
          <CheckCircle2 className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
          Conectado con {provider?.label}
        </div>
        <p className={hintClass}>
          Las invitaciones salen desde <span className="font-medium text-wa-text dark:text-wa-text-dark">{status.oauth_account_email}</span>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => connect.mutate(status.oauth_provider!)} disabled={connect.isPending || disconnect.isPending}>
            {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Cambiar cuenta
          </Button>
          <Button variant="ghost" size="sm" onClick={() => disconnect.mutate()} disabled={connect.isPending || disconnect.isPending}>
            {disconnect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Unlink className="h-3.5 w-3.5" aria-hidden="true" />}
            Desconectar
          </Button>
        </div>
        {connect.isError && <p className={errorClass} role="alert">{extractErrorMessage(connect.error)}</p>}
        {disconnect.isError && <p className={errorClass} role="alert">{extractErrorMessage(disconnect.error)}</p>}
      </div>
    )
  }

  if (available.length === 0) return null

  return (
    <div className={cardClass}>
      <div className={titleClass}>
        <Link2 className="h-4 w-4" aria-hidden="true" />
        Conectar tu correo
      </div>
      <p className={hintClass}>
        Entra con tu cuenta y autoriza el envío. No hace falta contraseña ni datos del servidor.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {available.map((provider) => (
          <Button
            key={provider.id}
            variant="secondary"
            className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
            onClick={() => connect.mutate(provider.id)}
            disabled={connect.isPending}
          >
            <span className="flex items-center gap-1.5">
              {connect.isPending && connect.variables === provider.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Conectar con {provider.label}
            </span>
            <span className="text-[11px] font-normal text-wa-muted dark:text-wa-muted-dark">{provider.hint}</span>
          </Button>
        ))}
      </div>
      {connect.isError && <p className={errorClass} role="alert">{extractErrorMessage(connect.error)}</p>}
    </div>
  )
}
