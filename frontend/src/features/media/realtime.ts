import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { mediaKeys } from './keys'

export function createMediaRealtime(): RealtimeModule {
  return {
    handlers: {
      media_library_updated: (_event, { queryClient }) => invalidate(queryClient, mediaKeys.all),
    },
  }
}
