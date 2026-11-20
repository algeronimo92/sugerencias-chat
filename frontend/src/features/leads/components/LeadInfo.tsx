import { CalendarX, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { readEditField, withoutEditField } from '../../../shared/navigation/editFieldLink'
import { Button } from '../../../shared/ui/Button'
import { PanelSection, PanelSectionAction } from '../../../shared/ui/PanelSection'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { displayPhone, displayUsername } from '../utils/chat'
import { useMarkNoShow } from '../queries'
import type { Chat } from '../types'
import { LeadCustomFields } from './LeadCustomFields'
import { LeadEditor } from './LeadEditor'

interface Props {
  chat: Chat
  /** Acciones de otras features al pie de los datos ("Analizar con IA"). */
  footer?: ReactNode
}

interface LeadInfoField {
  label: string
  value: string | null
}

/** fecha_recontacto es un DATE puro: `new Date('2026-08-01')` lo interpreta
 * como medianoche UTC y en zonas negativas muestra el día anterior. */
function formatDate(value: string | null): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Datos de la ficha que tienen algo que mostrar. */
function leadInfoFields(chat: Chat): LeadInfoField[] {
  // Ojo con el .filter(f => f.value) de abajo: descarta cualquier valor falsy,
  // así que los números se formatean a string acá (un 0 tiene que verse) y los
  // booleanos se resuelven a null cuando no hay nada que contar.
  // Nombre, etapa y vendedora no van: están en la cabecera del chat, a la
  // vista y editables. Repetirlos acá alargaba la ficha sin decir nada nuevo.
  const openedOrClosedAt = formatDateTime(chat.conversacion_abierta ? chat.conversacion_abierta_at : chat.conversacion_cerrada_at)
  const fields: LeadInfoField[] = [
    { label: 'Username', value: displayUsername(chat) },
    { label: 'Teléfono', value: displayPhone(chat) },
    { label: 'Teléfono secundario', value: chat.secondary_phone },
    {
      label: 'Conversación',
      value: `${chat.conversacion_abierta ? 'Abierta' : 'Cerrada'}${openedOrClosedAt ? ` desde ${openedOrClosedAt}` : ''}`,
    },
    { label: 'Servicio', value: chat.servicio_interes },
    { label: 'Origen', value: chat.origen },
    { label: 'Notas', value: chat.notas },
    { label: 'Próxima cita', value: formatDateTime(chat.proxima_cita) },
    { label: 'Recontacto', value: formatDate(chat.fecha_recontacto) },
    { label: 'Razón de pérdida', value: chat.razon_perdido },
    { label: 'Especialista', value: chat.con_especialista ? 'Derivado' : null },
    // No-shows y toques de seguimiento los lleva el sistema (el primero se
    // confirma a mano abajo, el segundo lo incrementan los recordatorios
    // automáticos de citas); último toque también es automático.
    { label: 'No-shows', value: chat.contador_noshow != null ? String(chat.contador_noshow) : null },
    { label: 'Toques de seguimiento', value: chat.toques_seguimiento != null ? String(chat.toques_seguimiento) : null },
    { label: 'Último toque', value: formatDateTime(chat.fecha_ultimo_toque) },
  ]
  return fields.filter((f) => f.value)
}

/** Acciones al pie de los datos: las de otras features y "Marcar no-show"
 * cuando hay una cita por delante. */
function LeadDataActions({ chat, footer }: Props) {
  const [noShowError, setNoShowError] = useState<string | null>(null)
  const { mutate: markNoShow, isPending: isMarkingNoShow } = useMarkNoShow(chat.chat_id)

  function handleMarkNoShow() {
    if (isMarkingNoShow) return
    setNoShowError(null)
    markNoShow(undefined, { onError: (err) => setNoShowError(extractErrorMessage(err)) })
  }

  return (
    <>
      {(chat.proxima_cita || footer) && (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          {footer}
          {chat.proxima_cita && (
            <Button variant="dangerGhost" size="sm" onClick={handleMarkNoShow} disabled={isMarkingNoShow}>
              <CalendarX className="h-3.5 w-3.5" aria-hidden="true" />
              {isMarkingNoShow ? 'Registrando…' : 'Marcar no-show'}
            </Button>
          )}
        </div>
      )}
      {noShowError && <p role="alert" className="mt-1 text-xs text-danger-fg">{noShowError}</p>}
    </>
  )
}

export function LeadInfo({ chat, footer }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const fields = leadInfoFields(chat)

  // Desde otra pantalla (Catálogos, al eliminar un servicio) se llega con
  // ?editar=servicio_interes: el editor se abre con ese campo resaltado. La URL
  // es el estado; al cerrar el editor se quita y recargar no lo reabre.
  const [searchParams, setSearchParams] = useSearchParams()
  const editRequest = readEditField(searchParams)
  const serviceRequest = editRequest?.field === 'servicio_interes' ? editRequest : null
  const showEditor = isEditing || serviceRequest !== null

  function closeEditor() {
    setIsEditing(false)
    if (serviceRequest) setSearchParams(withoutEditField(searchParams), { replace: true })
  }

  return (
    <>
    <PanelSection
      title="Datos"
      storageKey="ficha-seccion-datos"
      action={
        <PanelSectionAction label="Editar lead" onClick={() => setIsEditing(true)}>
          <Pencil />
        </PanelSectionAction>
      }
    >
      {fields.length > 0 && (
        <dl className="space-y-2">
          {fields.map(({ label, value }) => (
            <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 text-sm">
              <dt className="pt-px text-xs text-fg-muted">{label}</dt>
              <dd className="whitespace-pre-line break-words leading-snug text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <LeadCustomFields chatId={chat.chat_id} />

      <LeadDataActions chat={chat} footer={footer} />
    </PanelSection>

      {showEditor && (
        <LeadEditor chat={chat} serviceRequest={serviceRequest} onClose={closeEditor} />
      )}
    </>
  )
}
