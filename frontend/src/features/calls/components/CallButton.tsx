import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, PhoneForwarded } from 'lucide-react'

import { fetchCallPermission } from '../api'
import { useOptionalCallCenter } from '../callCenterContext'
import { callButtonState } from '../domain/callButtonState'
import { callKeys } from '../keys'

/** Llamar al cliente del chat. Solo lo ve quien tiene el permiso de llamadas. */
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
  const Icon = state.canCall ? Phone : PhoneForwarded
  return (
    <button
      type="button"
      title={state.hint}
      aria-label={`${state.label}. ${state.hint}`}
      aria-disabled={!state.canCall || busy}
      onClick={() => {
        if (busy) return
        if (state.canCall) call(chatId, name)
        else void queryClient.invalidateQueries({ queryKey: callKeys.permission(chatId) })
      }}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${
        state.canCall && !busy
          ? 'text-wa-primary-strong hover:bg-black/5 dark:text-wa-primary dark:hover:bg-white/5'
          : 'text-wa-muted opacity-60 dark:text-wa-muted-dark'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
