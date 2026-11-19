import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, PhoneForwarded } from 'lucide-react'
import { toast } from 'sonner'

import { extractErrorMessage } from '../../../shared/utils/errors'
import { fetchCallPermission, requestCallPermission } from '../api'
import { useOptionalCallCenter } from '../callCenterContext'
import { callButtonState } from '../domain/callButtonState'
import { callKeys } from '../keys'

/** Llamar al cliente del chat, o pedirle permiso si todavía no lo dio. Solo
 *  lo ve quien tiene el permiso de llamadas. */
export function CallButton({ chatId, name }: { chatId: string; name: string | null }) {
  const center = useOptionalCallCenter()
  const enabled = Boolean(center?.enabled)
  const queryClient = useQueryClient()
  const { data, isError } = useQuery({
    queryKey: callKeys.permission(chatId),
    queryFn: () => fetchCallPermission(chatId),
    enabled,
    retry: false,
    // El cliente puede aceptar el permiso mientras el chat está abierto.
    refetchInterval: query => (query.state.data?.can_call ? false : 20_000),
  })
  if (!center || !enabled) return null
  const { session, call } = center
  const state = callButtonState(data, isError)
  const busy = session.phase === 'connecting' || session.phase === 'active'
  const idle = state.action === 'none' || busy
  const Icon = state.action === 'call' ? Phone : PhoneForwarded

  function act() {
    if (busy) return
    if (state.action === 'call') call(chatId, name)
    else if (state.action === 'retry') void queryClient.invalidateQueries({ queryKey: callKeys.permission(chatId) })
    else if (state.action === 'request') {
      requestCallPermission(chatId)
        .then(() => {
          toast.success('Pedido de permiso enviado', { description: 'Cuando el cliente acepte, podrás llamarle desde aquí.' })
          void queryClient.invalidateQueries({ queryKey: callKeys.permission(chatId) })
        })
        // Fuera de la ventana de 24 h el backend lo rechaza con su motivo.
        .catch(error => toast.error(extractErrorMessage(error)))
    }
  }

  return (
    <button
      type="button"
      title={state.hint}
      aria-label={state.hint}
      aria-disabled={idle}
      onClick={act}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
        idle
          ? 'text-wa-muted opacity-60 dark:text-wa-muted-dark'
          : 'text-wa-primary-strong hover:bg-black/5 dark:text-wa-primary dark:hover:bg-white/5'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
