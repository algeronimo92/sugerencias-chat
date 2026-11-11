import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Info, Loader2, Mail, Send, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { IntegrationCard, type IntegrationState } from '../../../shared/ui/IntegrationCard'
import { Input, Select, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { clearPlatformEmail, fetchPlatformEmail, savePlatformEmail, sendPlatformEmailTest } from '../api'
import { platformKeys } from '../keys'
import type { PlatformEmailStatus } from '../types'

type Security = 'starttls' | 'ssl'

interface Draft {
  host: string
  port: string
  security: Security
  username: string
  password: string
  from_address: string
  from_name: string
}

function draftFrom(status: PlatformEmailStatus): Draft {
  return {
    host: status.host,
    port: String(status.port),
    security: status.security,
    username: status.username,
    password: '',
    from_address: status.from_address,
    from_name: status.from_name,
  }
}

function stateOf(status: PlatformEmailStatus | undefined): { state: IntegrationState; label?: string } {
  if (status?.source === 'platform') return { state: 'connected', label: 'Configurado aquí' }
  if (status?.source === 'environment') return { state: 'connected', label: 'Desde entorno (.env)' }
  return { state: 'unconfigured' }
}

function PlatformEmailForm({ status }: { status: PlatformEmailStatus }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(status))
  const [saved, setSaved] = useState(false)

  const onStatus = (next: PlatformEmailStatus) => {
    queryClient.setQueryData(platformKeys.email, next)
    setDraft(draftFrom(next))
  }

  const save = useMutation({
    mutationFn: () =>
      savePlatformEmail({
        host: draft.host.trim(),
        port: Number(draft.port),
        security: draft.security,
        username: draft.username.trim(),
        password: draft.password ? draft.password : null,
        from_address: draft.from_address.trim(),
        from_name: draft.from_name.trim(),
      }),
    onSuccess: (next) => {
      onStatus(next)
      setSaved(true)
    },
  })
  const clear = useMutation({
    mutationFn: clearPlatformEmail,
    onSuccess: (next) => {
      onStatus(next)
      setSaved(false)
      toast.success(next.source === 'environment' ? 'Se vuelve a usar el correo del .env' : 'Correo de la plataforma borrado')
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
  const test = useMutation({
    mutationFn: sendPlatformEmailTest,
    onSuccess: (result) => toast.success(`Correo de prueba enviado a ${result.recipient}`),
    onError: (error) => toast.error(extractErrorMessage(error)),
  })

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  const id = (name: string) => `${formId}-${name}`
  const busy = save.isPending || clear.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem_9rem]">
        <div>
          <label htmlFor={id('host')} className={labelClass}>Servidor SMTP</label>
          <Input id={id('host')} value={draft.host} onChange={(e) => setField('host', e.target.value)} placeholder="smtp.hostinger.com" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor={id('port')} className={labelClass}>Puerto</label>
          <Input id={id('port')} type="number" inputMode="numeric" min={1} max={65535} value={draft.port} onChange={(e) => setField('port', e.target.value)} required />
        </div>
        <div>
          <label htmlFor={id('security')} className={labelClass}>Seguridad</label>
          <Select id={id('security')} value={draft.security} onValueChange={(v) => setField('security', v as Security)}>
            <option value="starttls">STARTTLS</option>
            <option value="ssl">SSL/TLS</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={id('from')} className={labelClass}>Correo remitente</label>
          <Input id={id('from')} type="email" value={draft.from_address} onChange={(e) => setField('from_address', e.target.value)} placeholder="no-reply@cliniventas.com" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor={id('name')} className={labelClass}>Nombre del remitente</label>
          <Input id={id('name')} value={draft.from_name} onChange={(e) => setField('from_name', e.target.value)} placeholder="CliniVentas" maxLength={100} autoComplete="off" />
        </div>
        <div>
          <label htmlFor={id('user')} className={labelClass}>Usuario</label>
          <Input id={id('user')} value={draft.username} onChange={(e) => setField('username', e.target.value)} placeholder={draft.from_address || 'usuario'} autoComplete="off" />
        </div>
        <div>
          <label htmlFor={id('password')} className={labelClass}>Contraseña</label>
          <Input
            id={id('password')}
            type="password"
            value={draft.password}
            onChange={(e) => setField('password', e.target.value)}
            placeholder={status.password_configured ? '•••• sin cambios' : 'Sin configurar'}
            autoComplete="new-password"
          />
        </div>
      </div>

      {status.source !== 'platform' && status.environment_host && (
        <p className="flex items-start gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Hoy se envía con el SMTP del .env ({status.environment_host}, remitente {status.environment_from_address}). Al guardar
          aquí, este reemplaza al del .env por completo.
        </p>
      )}

      {save.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{extractErrorMessage(save.error)}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && !save.isPending && (
          <span className="mr-auto inline-flex items-center gap-1 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
          </span>
        )}
        {status.source === 'platform' && (
          <ConfirmDialog
            title="¿Borrar el correo de la plataforma?"
            description={
              status.environment_host
                ? `Los correos volverán a salir con el SMTP del .env (${status.environment_host}).`
                : 'No queda otro correo configurado: los negocios sin correo propio no podrán enviar invitaciones.'
            }
            confirmLabel="Borrar"
            onConfirm={() => clear.mutate()}
          >
            <Button variant="ghost" disabled={busy}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Borrar
            </Button>
          </ConfirmDialog>
        )}
        {status.source && (
          <Button variant="secondary" onClick={() => test.mutate()} disabled={busy || test.isPending}>
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Enviarme una prueba
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar correo
        </Button>
      </div>
    </form>
  )
}

/** Remitente de respaldo de todos los negocios: antes solo se cambiaba en el .env. */
export function PlatformEmailPanel() {
  const query = useQuery({ queryKey: platformKeys.email, queryFn: fetchPlatformEmail })
  const { state, label } = stateOf(query.data)

  return (
    <IntegrationCard
      id="plataforma-correo"
      icon={Mail}
      title="Correo de la plataforma"
      description="Desde aquí salen las invitaciones, los cambios de contraseña y los avisos de los negocios que no conectaron su propio correo. La prueba llega a tu correo de operador."
      state={state}
      stateLabel={label}
    >
      {query.isLoading && <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando correo…</p>}
      {query.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{extractErrorMessage(query.error)}</p>}
      {query.data && <PlatformEmailForm status={query.data} />}
    </IntegrationCard>
  )
}
