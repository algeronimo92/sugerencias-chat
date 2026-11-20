import { CalendarPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLeadCustomFieldValues } from '../../leads/public/queries'
import type { Chat } from '../../leads/types'
import { LeadAppointmentPanel } from '../components/LeadAppointmentPanel'
import type { LeadSnapshot } from '../domain/leadPrefill'

/**
 * "Separar cita": abre el formulario prellenado con el lead. Separar la cita
 * con su adelanto es la venta del negocio: vive en la cabecera del chat, a un
 * toque desde la conversación en cualquier ancho. Hasta el rediseño también
 * abría la ficha del lead como un botón verde grande; eran dos botones para lo
 * mismo, uno al lado del otro en escritorio.
 */
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
        aria-label="Separar cita para este lead"
        // Con texto desde tablet: es la acción que genera la venta y tiene
        // que leerse, no adivinarse por el ícono. En móvil la cabecera no da
        // para más y queda el ícono, con su nombre accesible.
        className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-accent-strong outline-none transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring max-sm:w-10 max-sm:px-0"
      >
        <CalendarPlus className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Separar cita</span>
      </button>
      {/* Si los campos del lead no cargan, se agenda igual sin prellenarlos. */}
      {open && <LeadAppointmentPanel lead={lead} leadReady={!values.isLoading} onClose={() => setOpen(false)} />}
    </>
  )
}
