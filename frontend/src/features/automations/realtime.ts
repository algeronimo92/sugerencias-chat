import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { automationKeys, executionKeys } from './keys'

export function createAutomationsRealtime(): RealtimeModule {
  return {
    handlers: {
      automations_updated: (_event, { queryClient }) => invalidate(
        queryClient, automationKeys.all, executionKeys.all, automationKeys.manualFlowsAll,
      ),
    },
  }
}
