/** Tiempo real de la agenda: la lista y las importaciones pendientes. */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { contactKeys } from './keys'

export function createContactsRealtime(): RealtimeModule {
  return {
    handlers: {
      contacts_updated: (_event, { queryClient }) => invalidate(queryClient, contactKeys.all),
      contact_imports_updated: (_event, { queryClient }) => invalidate(queryClient, contactKeys.imports),
    },
  }
}
