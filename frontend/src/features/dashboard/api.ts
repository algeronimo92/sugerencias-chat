import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { DashboardMetrics, DashboardScope } from './types'

export async function fetchDashboard(days: number, scope: DashboardScope | null, sellerId: number | null = null): Promise<DashboardMetrics> {
  return (
      await client.get<ApiResponse<'/api/dashboard', 'get'>>('/api/dashboard', {
        // Sin scope el backend elige por rol: el vendedor ve lo suyo y el
        // admin el total del equipo.
        // Con una vendedora elegida, el backend devuelve "lo suyo" (solo admin).
        params: { days, ...(sellerId ? { seller_id: sellerId } : scope ? { scope } : {}) },
      })
    ).data
}
