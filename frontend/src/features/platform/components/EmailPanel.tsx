import { CheckCircle2, Info, Loader2, Mail, Send, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input, Select, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
  useClearEmailSettings,
  useEmailSettings,
  useSaveEmailSettings,
  useSendEmailTest,
  type EmailSettingsStatus,
} from '../hooks/useEmailSettings'

const cardClass = 'space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark'
const titleClass = 'flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark'
const hintClass = 'text-[11px] text-wa-muted dark:text-wa-muted-dark'
const errorClass = 'text-xs text-red-500 dark:text-red-400'

type Security = 'starttls' | 'ssl'

// Los datos de conexión de los proveedores más usados: el admin elige el suyo
// y solo escribe su correo y la contraseña de aplicación.
const PROVIDERS: { id: string; label: string; host: string; port: number; security: Security }[] = [
  { id: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, security: 'starttls' },
  { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
  { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, security: 'ssl' },
  { id: 'hostinger', label: 'Hostinger', host: 'smtp.hostinger.com', port: 465, security: 'ssl' },
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
  return {
    host: status.host,
    port: status.port,
    security: status.security,
    username: status.username,
    password: '',
    from_address: status.from_address,
    from_name: status.from_name,
  }
}

function providerOf(draft: Draft): string {
  return PROVIDERS.find((p) => p.host === draft.host && p.port === draft.port && p.security === draft.security)?.id ?? OTHER
}

// El correo desde el que salen las invitaciones y avisos del negocio. Sin
// cargarlo se usa el de la plataforma, que no lleva el dominio del negocio.
export function EmailPanel() {
  const { data: status, isLoading, error } = useEmailSettings()

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-wa-muted dark:text-wa-muted-dark" aria-label="Cargando" />
      </div>
    )
  }
  if (error || !status) {
    return <p className={`${errorClass} py-8 text-center`}>No se pudo cargar la configuración de correo.</p>
  }
  return <EmailForm status={status} />
}

function EmailForm({ status }: { status: EmailSettingsStatus }) {
  const save = useSaveEmailSettings()
  const clear = useClearEmailSettings()
  const test = useSendEmailTest()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(status))
  const [provider, setProvider] = useState(() => (status.configured ? providerOf(draftFrom(status)) : 'gmail'))
  const [saved, setSaved] = useState(false)

  // Un formulario nuevo arranca con los datos de Gmail ya puestos.
  useEffect(() => {
    if (status.configured) return
    const gmail = PROVIDERS[0]
    setDraft((prev) => (prev.host ? prev : { ...prev, host: gmail.host, port: gmail.port, security: gmail.security }))
  }, [status.configured])

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    test.reset()
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

  function handleClear() {
    clear.mutate(undefined, {
      onSuccess: (next) => {
        const gmail = PROVIDERS[0]
        setDraft({ ...draftFrom(next), host: gmail.host, port: gmail.port, security: gmail.security })
        setProvider('gmail')
        setSaved(false)
        test.reset()
      },
    })
  }

  const busy = save.isPending || clear.isPending
  const canTest = status.configured || status.platform_available

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className={titleClass}>
          <Mail className="h-4 w-4" aria-hidden="true" />
          Correo de envío
        </div>
        <p className={hintClass}>
          Las invitaciones a tu equipo y los avisos salen desde este correo, con el nombre de tu negocio.
        </p>
        <StatusNote status={status} />
      </div>

      <form onSubmit={handleSubmit} className={cardClass}>
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
              placeholder={status.password_configured ? '•••• sin cambios' : 'Sin configurar'}
              autoComplete="new-password"
            />
          </div>
        </div>
        <p className={`${hintClass} flex items-start gap-1.5`}>
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Gmail y Outlook piden una contraseña de aplicación (se crea en la seguridad de tu cuenta, con la verificación
          en dos pasos activa). La contraseña normal de la cuenta no funciona.
        </p>

        {save.isError && <p className={errorClass} role="alert">{extractErrorMessage(save.error)}</p>}
        {clear.isError && <p className={errorClass} role="alert">{extractErrorMessage(clear.error)}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && (
            <span className="mr-auto flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
            </span>
          )}
          {status.configured && (
            <Button variant="ghost" onClick={handleClear} disabled={busy}>
              {clear.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Quitar
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
        </div>
      </form>

      {canTest && (
        <div className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={hintClass}>Te enviamos un correo de prueba a tu cuenta para comprobar que todo funciona.</p>
            <Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || busy}>
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
    </div>
  )
}

function StatusNote({ status }: { status: EmailSettingsStatus }) {
  if (status.configured) {
    return (
      <p className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-2 text-[11px] text-wa-primary-strong dark:border-green-900/60 dark:bg-green-950/20 dark:text-wa-primary">
        Se envía desde {status.from_address}.
      </p>
    )
  }
  if (status.platform_available) {
    return (
      <p className="rounded-lg border border-wa-border bg-wa-hover px-3 py-2 text-[11px] text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark">
        Por ahora se envía desde el correo de la plataforma. Carga el tuyo para que tu equipo reciba las invitaciones
        desde tu negocio.
      </p>
    )
  }
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
      Todavía no hay correo de envío: hasta cargar uno no se pueden mandar invitaciones.
    </p>
  )
}
