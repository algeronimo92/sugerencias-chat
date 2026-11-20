import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { automationKeys, executionKeys } from './keys'

export function createAutomationsRealtime(): RealtimeModule {
  return {
    handlers: {
      lead_visibility_changed: (_event, { queryClient }) => {
        void queryClient.resetQueries({ queryKey: executionKeys.all })
        void queryClient.resetQueries({ queryKey: automationKeys.manualFlowsAll })
      },
      automations_updated: (_event, { queryClient }) => invalidate(
        queryClient, automationKeys.all, executionKeys.all, automationKeys.manualFlowsAll,
      ),
    },
  }
}
