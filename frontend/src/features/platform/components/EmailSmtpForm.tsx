import { CheckCircle2, Info, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input, Select, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useSaveEmailSettings, type EmailSettingsStatus } from '../hooks/useEmailSettings'

const hintClass = 'text-[11px] text-wa-muted dark:text-wa-muted-dark'
const errorClass = 'text-xs text-red-500 dark:text-red-400'

type Security = 'starttls' | 'ssl'

// Datos de conexión de los proveedores sin "Conectar con…" (o para quien
// prefiere una contraseña de aplicación): el admin elige el suyo y solo
// escribe su correo y la contraseña.
const PROVIDERS: { id: string; label: string; host: string; port: number; security: Security }[] = [
  { id: 'hostinger', label: 'Hostinger', host: 'smtp.hostinger.com', port: 465, security: 'ssl' },
  { id: 'zoho', label: 'Zoho Mail (dominio propio)', host: 'smtppro.zoho.com', port: 465, security: 'ssl' },
  { id: 'gmail', label: 'Gmail (contraseña de aplicación)', host: 'smtp.gmail.com', port: 587, security: 'starttls' },
  { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
]
const OTHER = 'otro'
const PORTS = [587, 465, 2525, 25]

interface Draft {
  host: string
  port: number
  security: Security
  username: string
  password: string
  from_address: string
  from_name: string
}

function draftFrom(status: EmailSettingsStatus): Draft {
  const smtp = status.mode === 'smtp'
  const preset = PROVIDERS[0]
  return {
    host: smtp ? status.host : preset.host,
    port: smtp ? status.port : preset.port,
    security: smtp ? status.security : preset.security,
    username: status.username,
    password: '',
    from_address: status.from_address,
    from_name: status.from_name,
  }
}

function providerOf(draft: Draft): string {
  return PROVIDERS.find((p) => p.host === draft.host && p.port === draft.port && p.security === draft.security)?.id ?? OTHER
}

export function EmailSmtpForm({ status }: { status: EmailSettingsStatus }) {
  const save = useSaveEmailSettings()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(status))
  const [provider, setProvider] = useState(() => providerOf(draftFrom(status)))
  const [saved, setSaved] = useState(false)

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function chooseProvider(id: string) {
    setProvider(id)
    const preset = PROVIDERS.find((p) => p.id === id)
    if (preset) setDraft((prev) => ({ ...prev, host: preset.host, port: preset.port, security: preset.security }))
    setSaved(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const username = draft.username.trim() || draft.from_address.trim()
    save.mutate(
      { ...draft, username, password: draft.password ? draft.password : null },
      {
        onSuccess: (next) => {
          setDraft(draftFrom(next))
          setSaved(true)
        },
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label htmlFor="email-provider" className={labelClass}>Proveedor</label>
        <Select id="email-provider" value={provider} onValueChange={chooseProvider}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          <option value={OTHER}>Otro (SMTP)</option>
        </Select>
      </div>

      {provider === OTHER && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem_8rem]">
          <div>
            <label htmlFor="email-host" className={labelClass}>Servidor SMTP</label>
            <Input id="email-host" value={draft.host} onChange={(e) => setField('host', e.target.value)} placeholder="smtp.tudominio.com" autoComplete="off" required />
          </div>
          <div>
            <label htmlFor="email-port" className={labelClass}>Puerto</label>
            <Select id="email-port" value={String(draft.port)} onValueChange={(v) => setField('port', Number(v))}>
              {PORTS.map((port) => <option key={port} value={String(port)}>{port}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="email-security" className={labelClass}>Seguridad</label>
            <Select id="email-security" value={draft.security} onValueChange={(v) => setField('security', v as Security)}>
              <option value="starttls">STARTTLS</option>
              <option value="ssl">SSL/TLS</option>
            </Select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="email-from" className={labelClass}>Correo remitente</label>
          <Input id="email-from" type="email" value={draft.from_address} onChange={(e) => setField('from_address', e.target.value)} placeholder="ventas@tuclinica.com" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor="email-name" className={labelClass}>Nombre que ven los invitados</label>
          <Input id="email-name" value={draft.from_name} onChange={(e) => setField('from_name', e.target.value)} placeholder="Nombre de tu negocio" maxLength={100} autoComplete="off" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="email-user" className={labelClass}>Usuario (si no es el mismo correo)</label>
          <Input id="email-user" value={draft.username} onChange={(e) => setField('username', e.target.value)} placeholder={draft.from_address || 'usuario'} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="email-password" className={labelClass}>Contraseña de aplicación</label>
          <Input
            id="email-password"
            type="password"
            value={draft.password}
            onChange={(e) => setField('password', e.target.value)}
            placeholder={status.mode === 'smtp' && status.password_configured ? '•••• sin cambios' : 'Sin configurar'}
            autoComplete="new-password"
          />
        </div>
      </div>
      <p className={`${hintClass} flex items-start gap-1.5`}>
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Si tu cuenta tiene verificación en dos pasos, crea una contraseña de aplicación en la seguridad de tu cuenta; la
        contraseña normal no funciona.
      </p>

      {save.isError && <p className={errorClass} role="alert">{extractErrorMessage(save.error)}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && (
          <span className="mr-auto flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
          </span>
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {status.mode === 'oauth' ? 'Usar SMTP en su lugar' : 'Guardar'}
        </Button>
      </div>
    </form>
  )
}
