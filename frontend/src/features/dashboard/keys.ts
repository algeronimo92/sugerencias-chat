import type { DashboardScope } from './types'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  metrics: (days: number, scope: DashboardScope | null) => ['dashboard', days, scope] as const,
}
