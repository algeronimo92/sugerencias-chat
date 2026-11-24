import { useMemo } from 'react'
import { useChat, useLeadCustomFieldValues } from '../../leads/public/queries'
import { LeadAppointmentPanel } from '../components/LeadAppointmentPanel'
import type { LeadSnapshot } from '../domain/leadPrefill'

interface Props {
  leadId: string
  /** Lo que ya se sabe del lead mientras llega su ficha (p. ej. desde la agenda). */
  name: string | null
  phone: string | null
  onClose: () => void
}

/**
 * "Separar cita" para un lead del que solo se tiene el id: la agenda de
 * contactos. Es el mismo panel que el de la cabecera del chat; la ficha del
 * lead (servicio de interés, vendedora, campos del negocio) se trae antes de
 * prellenar, para que el paso de "actualizar el lead" compare contra lo que el
 * lead tiene de verdad y no contra vacíos.
 */
export function LeadAppointmentLauncher({ leadId, name, phone, onClose }: Props) {
  const chat = useChat(leadId)
  const values = useLeadCustomFieldValues(leadId)
  const lead = useMemo<LeadSnapshot>(() => ({
    id: leadId,
    name: chat.data?.name ?? name,
    phone: chat.data?.phone ?? phone,
    servicio_interes: chat.data?.servicio_interes ?? null,
    vendedor: chat.data?.vendedor ?? null,
    customFields: values.data ?? {},
  }), [leadId, name, phone, chat.data, values.data])

  // Si la ficha no carga, se agenda igual con lo que trajo la agenda.
  const ready = !chat.isLoading && !values.isLoading
  return <LeadAppointmentPanel lead={lead} leadReady={ready} onClose={onClose} />
}
