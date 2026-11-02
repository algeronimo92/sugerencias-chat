import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { templateKeys } from './keys'

export function createTemplatesRealtime(): RealtimeModule {
  return {
    handlers: {
      templates_updated: (_event, { queryClient }) => invalidate(queryClient, templateKeys.all),
    },
    resync: [templateKeys.all],
  }
}
