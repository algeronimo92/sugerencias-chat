import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { CustomFieldDefinition, CustomFieldEntity, ErpSyncStatus, ErpTestResult, LeadService, ServicePackage, ServiceUsageReport, Tag } from './types'

export async function fetchTags(includeInactive: boolean): Promise<Tag[]> {
  if (includeInactive) return (await client.get<ApiResponse<'/api/tags/all', 'get'>>('/api/tags/all')).data
  return (await client.get<ApiResponse<'/api/tags', 'get'>>('/api/tags')).data
}

export async function createTag(payload: { name: string; color: string }): Promise<Tag> {
  return (await client.post<ApiResponse<'/api/tags', 'post'>>('/api/tags', payload)).data
}

export async function updateTag({ id, ...values }: { id: number; name?: string; color?: string; is_active?: boolean }): Promise<Tag> {
  return (await client.patch<ApiResponse<'/api/tags/{tag_id}', 'patch'>>(`/api/tags/${id}`, values)).data
}

export async function fetchLeadServices(includeInactive: boolean): Promise<LeadService[]> {
  if (includeInactive) return (await client.get<ApiResponse<'/api/services/all', 'get'>>('/api/services/all')).data
  return (await client.get<ApiResponse<'/api/services', 'get'>>('/api/services')).data
}

export async function createLeadService(name: string): Promise<LeadService> {
  return (await client.post<ApiResponse<'/api/services', 'post'>>('/api/services', { name })).data
}

export async function updateLeadService({ id, ...values }: {
      id: number
      name?: string
      is_active?: boolean
    }): Promise<LeadService> {
  return (await client.patch<ApiResponse<'/api/services/{service_id}', 'patch'>>(`/api/services/${id}`, values)).data
}

export async function fetchServiceUsage(id: number): Promise<ServiceUsageReport> {
  const { data } = await client.get<ApiResponse<'/api/services/{service_id}/usage', 'get'>>(`/api/services/${id}/usage`)
  return { usages: data.usages ?? [], notices: data.notices ?? [] }
}

/** Pasa todos los leads con ese servicio de interés a otro (o a ninguno, con
 *  null). La ruta es de leads, dueño de esa columna; la llama Catálogos para
 *  poder eliminar un servicio que usan muchos leads. */
export async function reassignServiceLeads({ fromService, toService }: { fromService: string; toService: string | null }): Promise<number> {
  const body = { from_service: fromService, to_service: toService }
  return (await client.post<ApiResponse<'/api/chats/service-interest/reassign', 'post'>>('/api/chats/service-interest/reassign', body)).data.updated
}

/** Solo un servicio manual que nadie usa; si algo lo usa, el 409 dice qué. */
export async function deleteLeadService(id: number): Promise<void> {
  await client.delete<ApiResponse<'/api/services/{service_id}', 'delete'>>(`/api/services/${id}`)
}

export interface ServicePackageInput {
  name: string
  sessions: number
  price: string
  notes?: string
}

export async function createServicePackage({ serviceId, ...values }: { serviceId: number } & ServicePackageInput): Promise<ServicePackage> {
  return (await client.post<ApiResponse<'/api/services/{service_id}/packages', 'post'>>(`/api/services/${serviceId}/packages`, values)).data
}

export async function updateServicePackage({ serviceId, id, ...values }: {
      serviceId: number
      id: number
      name?: string
      sessions?: number
      price?: string
      notes?: string
      position?: number
      is_active?: boolean
    }): Promise<ServicePackage> {
  return (await client.patch<ApiResponse<'/api/services/{service_id}/packages/{package_id}', 'patch'>>(`/api/services/${serviceId}/packages/${id}`, values)).data
}

export async function fetchErpSyncStatus(): Promise<ErpSyncStatus> {
  return (await client.get<ApiResponse<'/api/services/erp-sync', 'get'>>('/api/services/erp-sync')).data
}

/** En blanco prueba la URL guardada; con valor, la que el admin está escribiendo. */
export async function testErpConnection(url: string | null): Promise<ErpTestResult> {
  return (await client.post<ApiResponse<'/api/services/erp-sync/test', 'post'>>('/api/services/erp-sync/test', { url })).data
}

export async function runErpSync(): Promise<ErpSyncStatus> {
  return (await client.post<ApiResponse<'/api/services/erp-sync', 'post'>>('/api/services/erp-sync')).data
}

export async function fetchCustomFields(entityType: CustomFieldEntity, includeInactive: boolean): Promise<CustomFieldDefinition[]> {
  return (await client.get<ApiResponse<'/api/custom-fields', 'get'>>('/api/custom-fields', {
      params: { entity_type: entityType, include_inactive: includeInactive },
    })).data
}

export async function createCustomField(values: Omit<CustomFieldDefinition, 'id' | 'key' | 'is_active'> & { key?: string }): Promise<CustomFieldDefinition> {
  return (await client.post<ApiResponse<'/api/custom-fields', 'post'>>('/api/custom-fields', values)).data
}

export async function updateCustomField({ id, ...values }: { id: number; label?: string; required?: boolean; options?: string[]; position?: number; is_active?: boolean }): Promise<CustomFieldDefinition> {
  return (await client.patch<ApiResponse<'/api/custom-fields/{field_id}', 'patch'>>(`/api/custom-fields/${id}`, values)).data
}
