/** Tiempo real de la agenda: la lista y las importaciones pendientes. */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { contactKeys } from './keys'

export function createContactsRealtime(): RealtimeModule {
  return {
    handlers: {
      lead_visibility_changed: (_event, { queryClient }) => {
        void queryClient.resetQueries({ queryKey: contactKeys.all })
      },
      contacts_updated: (_event, { queryClient }) => invalidate(queryClient, contactKeys.all),
      contact_imports_updated: (_event, { queryClient }) => invalidate(queryClient, contactKeys.imports),
    },
  }
}
