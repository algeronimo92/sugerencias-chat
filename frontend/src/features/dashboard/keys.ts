import type { DashboardScope } from './types'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  metrics: (days: number, scope: DashboardScope | null, sellerId: number | null = null) => ['dashboard', days, scope, sellerId] as const,
}
