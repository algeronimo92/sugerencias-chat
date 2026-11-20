/** Tiempo real del asistente: un mensaje nuevo del cliente deja vieja la
 * sugerencia guardada de ese chat. */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { aiKeys } from './keys'

export function createAiRealtime(): RealtimeModule {
  return {
    handlers: {
      lead_visibility_changed: (_event, { queryClient }) => {
        void queryClient.resetQueries({ queryKey: aiKeys.suggestionsAll })
      },
      chats_updated: (event, { queryClient }) => {
        const latest = event.latest_message
        if (latest?.sender === 'cliente') invalidate(queryClient, aiKeys.suggestions(latest.chat_id))
      },
    },
  }
}
