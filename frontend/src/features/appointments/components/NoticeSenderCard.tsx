import { Check, Link2, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { IntegrationCard } from '../../../shared/ui/IntegrationCard'
import { Select, fieldClass, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMetaEmbeddedSignup } from '../../platform/public/useMetaEmbeddedSignup'
import { useCopyNoticeTemplates, useLinkNoticeSender, useNoticeSender, useSaveNoticeSender } from '../queries'
import type { NoticeSender } from '../types'

type SenderNumber = NoticeSender['numbers'][number]

function numberLabel(number: SenderNumber): string {
  const name = number.verified_name ? ` · ${number.verified_name}` : ''
  return `${number.display_phone_number || number.id}${name}`
}

/** Desde qué número de WhatsApp salen los avisos de cita: el del CRM u otro
 *  del portfolio del negocio. Lo que le respondan no abre chats en el CRM. */
export function NoticeSenderCard() {
  const { data, isLoading, isError, error } = useNoticeSender()
  const chosen = data?.numbers.find(number => number.id === data.phone_number_id) ?? null
  return (
    <IntegrationCard
      id="numero-de-avisos"
      icon={Send}
      title="Número de avisos"
      description="Los avisos de cita pueden salir de un número distinto al de los chats."
      state={chosen ? 'connected' : 'unconfigured'}
      stateLabel={chosen ? numberLabel(chosen) : 'Número del CRM'}
    >
      {isLoading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-wa-muted" aria-label="Cargando números" />
      ) : isError || !data ? (
        <p role="alert" className="text-xs text-red-500 dark:text-red-400">
          No se pudieron leer los números: {extractErrorMessage(error)}
        </p>
      ) : (
        <div className="space-y-4">
          <SenderForm sender={data} />
          {data.account && data.phone_number_id && <AccountTemplates sender={data} />}
          <LinkWithMeta />
        </div>
      )}
    </IntegrationCard>
  )
}

function SenderForm({ sender }: { sender: NoticeSender }) {
  const save = useSaveNoticeSender()
  const [selected, setSelected] = useState(sender.phone_number_id ?? '')
  const others = sender.numbers.filter(number => !number.is_crm)
  const dirty = selected !== (sender.phone_number_id ?? '')

  if (others.length === 0 && !sender.phone_number_id) {
    return (
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        Los avisos salen del número del CRM. Vincula otro número para enviarlos desde ahí.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="notice-sender-number" className={labelClass}>Enviar los avisos desde</label>
        <Select
          id="notice-sender-number"
          value={selected}
          onValueChange={value => {
            save.reset()
            setSelected(value)
          }}
          disabled={save.isPending}
          className={fieldClass}
        >
          <option value="">El número del CRM (el de los chats)</option>
          {others.map(number => <option key={number.id} value={number.id}>{numberLabel(number)}</option>)}
        </Select>
      </div>
      <p className="text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">
        Las respuestas a otro número no entran al CRM.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {save.isError && (
          <p role="alert" className="text-xs text-red-500 dark:text-red-400">{extractErrorMessage(save.error)}</p>
        )}
        {save.isSuccess && !dirty && (
          <p role="status" className="inline-flex items-center gap-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
          </p>
        )}
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(selected || null)}>
          {save.isPending ? 'Guardando…' : 'Guardar número'}
        </Button>
      </div>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprobada',
  PENDING: 'En revisión de Meta',
  IN_APPEAL: 'En revisión de Meta',
  REJECTED: 'Rechazada',
  PAUSED: 'Pausada',
  DISABLED: 'Desactivada',
  MISSING: 'Sin copiar',
}

const AUDIENCE_LABELS: Record<string, string> = { client: 'Aviso al cliente', staff: 'Aviso al equipo' }

/** El número de avisos en su propia cuenta de WhatsApp Business (en
 *  coexistencia Meta siempre crea una): ahí los avisos usan copias de las
 *  plantillas, que Meta aprueba de nuevo. */
function AccountTemplates({ sender }: { sender: NoticeSender }) {
  const copy = useCopyNoticeTemplates()
  const missing = sender.templates.some(item => item.status === 'MISSING')
  return (
    <div className="space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark">
      <p className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">
        Plantillas en {sender.account?.name || 'la cuenta del número de avisos'}
      </p>
      {sender.templates.length === 0 ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Ningún aviso tiene plantilla elegida.</p>
      ) : (
        <ul className="space-y-1.5">
          {sender.templates.map(item => (
            <li key={`${item.audience}-${item.template_id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-wa-text dark:text-wa-text-dark">
                {AUDIENCE_LABELS[item.audience] ?? item.audience}: <span className="font-medium">{item.name}</span>
              </span>
              <span
                className={
                  item.status === 'APPROVED'
                    ? 'text-xs text-emerald-700 dark:text-emerald-300'
                    : item.status === 'REJECTED' || item.status === 'MISSING'
                      ? 'text-xs text-red-500 dark:text-red-400'
                      : 'text-xs text-wa-muted dark:text-wa-muted-dark'
                }
              >
                {STATUS_LABELS[item.status] ?? item.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      {copy.isError && (
        <p role="alert" className="text-xs text-red-500 dark:text-red-400">{extractErrorMessage(copy.error)}</p>
      )}
      {missing && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => copy.mutate()} disabled={copy.isPending}>
            {copy.isPending ? 'Copiando…' : 'Copiar plantillas'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Vincula un número nuevo con el registro de Meta en coexistencia: sigue
 *  funcionando en la app de WhatsApp Business del celular y queda como
 *  número de avisos, sin tocar el número de los chats. */
function LinkWithMeta() {
  const link = useLinkNoticeSender()
  const signup = useMetaEmbeddedSignup(payload =>
    link.mutate(payload, {
      onSuccess: () => toast.success('Número de avisos vinculado con Meta'),
      onError: err => signup.setError(extractErrorMessage(err)),
    }),
  )

  if (signup.loading || !signup.configured) return null

  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" onClick={signup.start} disabled={!signup.ready || link.isPending}>
        {link.isPending
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <Link2 className="h-4 w-4" aria-hidden="true" />}
        Vincular número de avisos con Meta
      </Button>
      {signup.error && (
        <p role="alert" className="text-xs text-red-500 dark:text-red-400">{signup.error}</p>
      )}
    </div>
  )
}
