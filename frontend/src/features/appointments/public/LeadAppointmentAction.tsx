import { CalendarPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLeadCustomFieldValues } from '../../leads/public/queries'
import type { Chat } from '../../leads/types'
import { LeadAppointmentPanel } from '../components/LeadAppointmentPanel'
import type { LeadSnapshot } from '../domain/leadPrefill'

/** "Agendar cita" en la ficha del lead: abre el formulario prellenado. */
export function LeadAppointmentAction({ chat }: { chat: Chat }) {
  const [open, setOpen] = useState(false)
  const values = useLeadCustomFieldValues(open ? chat.chat_id : '')
  const lead = useMemo<LeadSnapshot>(() => ({
    id: chat.chat_id,
    name: chat.name,
    phone: chat.phone,
    servicio_interes: chat.servicio_interes,
    vendedor: chat.vendedor,
    customFields: values.data ?? {},
  }), [chat.chat_id, chat.name, chat.phone, chat.servicio_interes, chat.vendedor, values.data])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-wa-border bg-white px-4 py-3 text-left text-sm font-semibold text-wa-primary-strong transition-colors hover:bg-wa-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-primary dark:hover:bg-wa-hover-dark"
      >
        <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
        Agendar cita
      </button>
      {/* Si los campos del lead no cargan, se agenda igual sin prellenarlos. */}
      {open && <LeadAppointmentPanel lead={lead} leadReady={!values.isLoading} onClose={() => setOpen(false)} />}
    </>
  )
}
