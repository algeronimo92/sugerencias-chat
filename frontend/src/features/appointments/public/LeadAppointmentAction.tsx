import { CalendarPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLeadCustomFieldValues } from '../../leads/public/queries'
import type { Chat } from '../../leads/types'
import { LeadAppointmentPanel } from '../components/LeadAppointmentPanel'
import type { LeadSnapshot } from '../domain/leadPrefill'

/**
 * "Separar cita": abre el formulario prellenado con el lead. Separar la cita
 * con su adelanto es la venta del negocio, así que la acción vive en dos
 * lugares: en la cabecera del chat (`variant="header"`, un toque desde la
 * conversación) y como primer bloque de la ficha del lead.
 */
export function LeadAppointmentAction({ chat, variant = 'card' }: { chat: Chat; variant?: 'card' | 'header' }) {
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
      {variant === 'header' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Separar cita para este lead"
          title="Separar cita"
          // Con texto desde tablet: es la acción que genera la venta y tiene
          // que leerse, no adivinarse por el ícono. En móvil la cabecera no da
          // para más y queda el ícono, con su nombre accesible.
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-wa-primary-strong transition-colors hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong dark:text-wa-primary dark:hover:bg-green-950/30 max-sm:w-11 max-sm:px-0"
        >
          <CalendarPlus className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Separar cita</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-wa-primary-strong px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-wa-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong focus-visible:ring-offset-2 dark:focus-visible:ring-offset-wa-panel-dark"
        >
          <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
          Separar cita
        </button>
      )}
      {/* Si los campos del lead no cargan, se agenda igual sin prellenarlos. */}
      {open && <LeadAppointmentPanel lead={lead} leadReady={!values.isLoading} onClose={() => setOpen(false)} />}
    </>
  )
}
