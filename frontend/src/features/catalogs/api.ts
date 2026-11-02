import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { CustomFieldDefinition, CustomFieldEntity, LeadService, Tag } from './types'

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
      description?: string
      price?: string | null
      price_notes?: string
    }): Promise<LeadService> {
  return (await client.patch<ApiResponse<'/api/services/{service_id}', 'patch'>>(`/api/services/${id}`, values)).data
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
