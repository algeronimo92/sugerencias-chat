import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { issueReportKeys } from './keys'

export function createIssueReportsRealtime(): RealtimeModule {
  return {
    handlers: {
      issue_reports_updated: (_event, { queryClient }) => invalidate(queryClient, issueReportKeys.all),
    },
    resync: [issueReportKeys.all],
  }
}
