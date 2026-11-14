import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { DashboardExportFile, DashboardExportReport, DashboardMetrics, DashboardScope } from './types'

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

export async function downloadDashboardExport(report: DashboardExportReport, days: number): Promise<DashboardExportFile> {
  const response = await client.get<ApiResponse<'/api/dashboard/export/{report}', 'get'>>(`/api/dashboard/export/${report}`, {
    params: { days },
    responseType: 'blob',
  })
  // El contrato tipa solo cuerpos JSON; este trae el .xlsx en binario.
  const blob = response.data as unknown as Blob
  const disposition = String(response.headers['content-disposition'] ?? '')
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${report}.xlsx`
  return { blob, filename }
}
