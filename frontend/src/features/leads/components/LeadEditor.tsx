import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useUpdateLead } from '../queries'
import type { Chat, LeadUpdateInput } from '../types'
import { useLeadStageCatalog } from '../hooks/useLeadStages'
import { LeadFormDialog } from './LeadFormDialog'
import { useMoveLeadStage } from '../kanban-queries'

interface Props {
  chat: Chat
  /** Se llegó desde Catálogos para corregir el servicio: el campo va
   * resaltado con el motivo (que puede faltar) y, al guardar, se ofrece
   * volver. null si se abrió desde la ficha. */
  serviceRequest: { reason: string | null } | null
  onClose: () => void
}

/** Diálogo "Editar lead" de la ficha: guarda los datos y, si se eligió otra
 * etapa, mueve el lead. Se monta al abrirse, así que el error arranca vacío. */
export function LeadEditor({ chat, serviceRequest, onClose }: Props) {
  const [editError, setEditError] = useState<string | null>(null)
  const navigate = useNavigate()
  const updateLead = useUpdateLead(chat.chat_id)
  const moveLeadStage = useMoveLeadStage()
  const isSaving = updateLead.isPending || moveLeadStage.isPending
  const stageCatalog = useLeadStageCatalog()

  async function handleUpdate(values: LeadUpdateInput, selectedStage?: string) {
    if (isSaving) return
    setEditError(null)
    const cameFromCatalog = serviceRequest !== null
    try {
      const updated = await updateLead.mutateAsync(values)
      if (selectedStage && selectedStage !== chat.stage) {
        await moveLeadStage.mutateAsync({
          chatId: chat.chat_id,
          stage: selectedStage,
          razonPerdido: values.razon_perdido,
        })
      }
      onClose()
      // Cambió el número: el lead vive bajo otro chat_id, hay que seguirlo.
      if (updated.chat_id !== chat.chat_id) navigate(`/chat/${updated.chat_id}`)
      if (cameFromCatalog) {
        toast.success('Servicio de interés actualizado', {
          action: { label: 'Volver a Catálogos', onClick: () => navigate('/catalogs') },
        })
      }
    } catch (err) {
      setEditError(extractErrorMessage(err))
    }
  }

  return (
    <LeadFormDialog
      title="Editar lead"
      submitLabel="Guardar"
      // El teléfono se bloquea solo cuando ya hay algo resuelto que
      // cambiarlo podría redirigir sin querer. Con telefono en null (un
      // user_id de Meta que nunca reveló el número) no hay nada que
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
      initialStage={chat.stage}
      stageCatalog={stageCatalog}
      isSubmitting={isSaving}
      error={editError}
      onSubmit={handleUpdate}
      onCancel={onClose}
      highlightService={serviceRequest ? { reason: serviceRequest.reason } : undefined}
    />
  )
}
