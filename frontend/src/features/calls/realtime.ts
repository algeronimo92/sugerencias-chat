/** Tiempo real de las llamadas de WhatsApp: qué suena y qué terminó. */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { CALL_ENDED_EVENT } from './callCenterContext'
import { callKeys } from './keys'

export function createCallsRealtime(): RealtimeModule {
  return {
    handlers: {
      call_incoming: (_event, { queryClient }) => invalidate(queryClient, callKeys.ringing),
      call_updated: (_event, { queryClient }) => invalidate(queryClient, callKeys.ringing),
      call_ended: (event, { queryClient, notify, navigate }) => {
        invalidate(queryClient, callKeys.all)
        window.dispatchEvent(new CustomEvent(CALL_ENDED_EVENT, { detail: event.call_id }))
        if (event.status === 'missed') {
          notify(
            'Llamada perdida',
            event.caller_name ? `De ${event.caller_name}` : 'De un cliente',
            () => navigate(`/chat/${event.chat_id}`),
            { force: true, tag: `call-${event.call_id}` },
          )
        }
      },
    },
    // Lo que sonó con el socket caído: se relee al reconectar.
    resync: [callKeys.ringing],
  }
}
