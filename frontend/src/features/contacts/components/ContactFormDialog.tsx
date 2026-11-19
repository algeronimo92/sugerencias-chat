import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input, Textarea, labelClass } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { splitTags } from '../domain/selection'
import { useCreateContact, useUpdateContact } from '../hooks/useContacts'
import type { Contact } from '../types'

interface Props {
  /** Sin contacto: alta nueva. */
  contact: Contact | null
  onClose: () => void
}

/** Alta y edición. Lo que se escribe acá manda: un cambio de nombre que
 *  llegue después del celular ya no lo pisa. */
export function ContactFormDialog({ contact, onClose }: Props) {
  const create = useCreateContact()
  const update = useUpdateContact()
  const [nombre, setNombre] = useState(contact?.nombre ?? '')
  const [telefono, setTelefono] = useState(contact?.telefono ? `+${contact.telefono}` : '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [etiquetas, setEtiquetas] = useState(contact?.etiquetas.join(', ') ?? '')
  const [notas, setNotas] = useState(contact?.notas ?? '')
  const [consent, setConsent] = useState(contact?.consentimiento_marketing ?? false)
  const busy = create.isPending || update.isPending
  const phoneRequired = !contact?.wa_user_id

  function submit(event: FormEvent) {
    event.preventDefault()
    const values = {
      nombre: nombre.trim() || null,
      email: email.trim() || null,
      notas: notas.trim() || null,
      etiquetas: splitTags(etiquetas),
      consentimiento_marketing: consent,
    }
    const onError = (err: unknown) => toast.error('No se pudo guardar el contacto', { description: extractErrorMessage(err) })
    if (contact) {
      update.mutate({ id: contact.id, ...values, telefono: telefono.trim() || null }, {
        onSuccess: () => { toast.success('Contacto actualizado'); onClose() },
        onError,
      })
    } else {
      create.mutate({ ...values, telefono: telefono.trim() }, {
        onSuccess: () => { toast.success('Contacto agregado'); onClose() },
        onError,
      })
    }
  }

  return (
    <Modal
      title={contact ? 'Editar contacto' : 'Nuevo contacto'}
      description="Queda en la agenda. Para escribirle, pásalo a lead."
      size="md"
      layer="confirm"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" form="contact-form" disabled={busy || (phoneRequired && !telefono.trim())}>
            {busy ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      )}
    >
      <form id="contact-form" onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={labelClass}>Nombre</span>
          <Input value={nombre} onChange={event => setNombre(event.target.value)} maxLength={200} autoComplete="off" />
        </label>
        <label className="block">
          <span className={labelClass}>Teléfono{phoneRequired ? ' (obligatorio)' : ''}</span>
          <Input
            value={telefono}
            onChange={event => setTelefono(event.target.value)}
            inputMode="tel"
            placeholder="987 654 321 o +51 987 654 321"
            maxLength={40}
            required={phoneRequired}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Correo</span>
          <Input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={200} />
        </label>
        <label className="block">
          <span className={labelClass}>Etiquetas (separadas por coma)</span>
          <Input value={etiquetas} onChange={event => setEtiquetas(event.target.value)} placeholder="vip, botox" />
        </label>
        <label className="block">
          <span className={labelClass}>Notas</span>
          <Textarea value={notas} onChange={event => setNotas(event.target.value)} rows={3} maxLength={2000} />
        </label>
        <label className="flex items-start gap-2 text-sm text-wa-text dark:text-wa-text-dark">
          <Checkbox checked={consent} onCheckedChange={setConsent} className="mt-0.5" />
          <span>
            Aceptó recibir publicidad
            <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
              Meta exige este permiso antes de mandarle plantillas de marketing.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  )
}
