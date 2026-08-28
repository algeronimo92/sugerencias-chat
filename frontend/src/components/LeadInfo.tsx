import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, CalendarDays, CalendarX, CircleDot, Contact, MessageCircle, MessageCircleOff, Phone, Repeat, Tag, User, UserRound, MapPin, FileText, Pencil, XCircle, type LucideIcon } from 'lucide-react'
import type { Chat, LeadUpdateInput } from '../types'
import { LEAD_STAGE_META } from '../domain/leadStageMeta'
import { useMarkNoShow, useUpdateLead } from '../hooks/useChats'
import { displayPhone } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { LeadFormDialog } from './LeadFormDialog'

interface Props {
  chat: Chat
}

interface LeadInfoField {
  label: string
  value: string | null
  icon: LucideIcon
  iconClassName?: string
  valueClassName?: string
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

export function LeadInfo({ chat }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [noShowError, setNoShowError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { mutate: updateLead, isPending: isSaving } = useUpdateLead(chat.chat_id)
  const { mutate: markNoShow, isPending: isMarkingNoShow } = useMarkNoShow(chat.chat_id)
  const stageMeta = LEAD_STAGE_META[chat.stage]

  function handleMarkNoShow() {
    if (isMarkingNoShow) return
    setNoShowError(null)
    markNoShow(undefined, { onError: (err) => setNoShowError(extractErrorMessage(err)) })
  }

  // Ojo con el .filter(f => f.value) de abajo: descarta cualquier valor falsy,
  // así que los números se formatean a string acá (un 0 tiene que verse) y los
  // booleanos se resuelven a null cuando no hay nada que contar.
  const fields: LeadInfoField[] = [
    { label: 'Nombre', value: chat.name, icon: Contact },
    { label: 'Teléfono', value: displayPhone(chat), icon: Phone },
    { label: 'Teléfono secundario', value: chat.secondary_phone, icon: Phone },
    { label: 'Estado', value: stageMeta.label, icon: CircleDot, iconClassName: stageMeta.accent, valueClassName: stageMeta.badge },
    {
      label: 'Conversación',
      value: chat.conversacion_abierta ? 'Abierta' : 'Cerrada',
      icon: chat.conversacion_abierta ? MessageCircle : MessageCircleOff,
      iconClassName: chat.conversacion_abierta ? 'text-wa-primary' : 'text-red-500',
    },
    {
      label: chat.conversacion_abierta ? 'Abierta desde' : 'Cerrada desde',
      value: formatDateTime(chat.conversacion_abierta ? chat.conversacion_abierta_at : chat.conversacion_cerrada_at),
      icon: CalendarClock,
    },
    { label: 'Servicio', value: chat.servicio_interes, icon: Tag },
    { label: 'Vendedor', value: chat.vendedor, icon: User },
    { label: 'Origen', value: chat.origen, icon: MapPin },
    { label: 'Notas', value: chat.notas, icon: FileText },
    { label: 'Próxima cita', value: formatDateTime(chat.proxima_cita), icon: CalendarClock },
    { label: 'Recontacto', value: formatDate(chat.fecha_recontacto), icon: CalendarDays },
    { label: 'Razón de pérdida', value: chat.razon_perdido, icon: XCircle },
    { label: 'Especialista', value: chat.con_especialista ? 'Derivado' : null, icon: UserRound },
    // No-shows y toques de seguimiento los lleva el sistema (el primero se
    // confirma a mano abajo, el segundo lo incrementan los recordatorios
    // automáticos de citas); último toque también es automático.
    { label: 'No-shows', value: chat.contador_noshow != null ? String(chat.contador_noshow) : null, icon: CalendarX },
    { label: 'Toques de seguimiento', value: chat.toques_seguimiento != null ? String(chat.toques_seguimiento) : null, icon: Repeat },
    { label: 'Último toque', value: formatDateTime(chat.fecha_ultimo_toque), icon: CalendarClock },
  ].filter((f) => f.value)

  function handleUpdate(values: LeadUpdateInput) {
    if (isSaving) return
    setEditError(null)
    updateLead(values, {
      onSuccess: (updated) => {
        setIsEditing(false)
        // Cambió el número: el lead vive bajo otro chat_id, hay que seguirlo.
        if (updated.chat_id !== chat.chat_id) navigate(`/chat/${updated.chat_id}`)
      },
      onError: (err) => setEditError(extractErrorMessage(err)),
    })
  }

  return (
    <div className="bg-white dark:bg-wa-head-dark rounded-xl border border-wa-border dark:border-wa-border-dark p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide">
          Datos del lead
        </h3>
        <button type="button"
          onClick={() => {
            setEditError(null)
            setIsEditing(true)
          }}
          aria-label="Editar lead"
          className="text-wa-muted dark:text-wa-muted-dark hover:text-wa-primary-strong dark:hover:text-wa-primary transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {fields.length > 0 && (
        <dl className="space-y-2.5">
          {fields.map(({ label, value, icon: Icon, iconClassName, valueClassName }) => (
            <div key={label} className="flex items-start gap-2.5 text-sm">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClassName ?? 'text-wa-muted dark:text-wa-muted-dark'}`} />
              <div className="min-w-0">
                <dt className="text-[11px] font-medium text-wa-muted dark:text-wa-muted-dark leading-none mb-0.5">{label}</dt>
                <dd className={valueClassName ? `inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${valueClassName}` : 'text-gray-700 dark:text-gray-300 leading-snug'}>
                  {value}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      )}

      {chat.proxima_cita && (
        <div className="mt-3 pt-3 border-t border-wa-border dark:border-wa-border-dark">
          <button type="button"
            onClick={handleMarkNoShow}
            disabled={isMarkingNoShow}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            <CalendarX className="w-3.5 h-3.5" />
            {isMarkingNoShow ? 'Registrando…' : 'Marcar no-show'}
          </button>
          {noShowError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{noShowError}</p>
          )}
        </div>
      )}

      {isEditing && (
        <LeadFormDialog
          title="Editar lead"
          submitLabel="Guardar"
          // El teléfono se bloquea solo cuando ya hay algo resuelto que
          // cambiarlo podría redirigir sin querer. Con telefono en null (un
          // @lid del que WhatsApp nunca reveló el número) no hay nada que
          // proteger, aunque ya haya conversación — se deja completar a mano.
          canEditPhone={chat.last_message == null || chat.phone == null}
          phoneEditIsRisky={chat.last_message != null && chat.phone == null}
          initial={{
            phone: chat.phone,
            secondary_phone: chat.secondary_phone,
            name: chat.name,
            servicio_interes: chat.servicio_interes,
            vendedor_id: chat.vendedor_id,
            origen: chat.origen,
            notas: chat.notas,
            con_especialista: chat.con_especialista,
            razon_perdido: chat.razon_perdido,
            fecha_recontacto: chat.fecha_recontacto,
            proxima_cita: chat.proxima_cita,
          }}
          isSubmitting={isSaving}
          error={editError}
          onSubmit={handleUpdate}
          onCancel={() => setIsEditing(false)}
        />
      )}
    </div>
  )
}
