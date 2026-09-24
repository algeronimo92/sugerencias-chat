import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'

export type CustomFieldEntity = 'lead' | 'appointment'
export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'boolean' | 'select'

export interface CustomFieldDefinition {
  id: number
  entity_type: CustomFieldEntity
  key: string
  label: string
  field_type: CustomFieldType
  required: boolean
  options: string[]
  position: number
  is_active: boolean
}

export function useCustomFields(entityType: CustomFieldEntity, includeInactive = false) {
  return useQuery({
    queryKey: ['custom-fields', entityType, { includeInactive }],
    queryFn: async () => (await client.get<CustomFieldDefinition[]>('/api/custom-fields', {
      params: { entity_type: entityType, include_inactive: includeInactive },
    })).data,
    staleTime: 60_000,
  })
}

export function useCreateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: Omit<CustomFieldDefinition, 'id' | 'key' | 'is_active'> & { key?: string }) =>
      (await client.post<CustomFieldDefinition>('/api/custom-fields', values)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: number; label?: string; required?: boolean; options?: string[]; position?: number; is_active?: boolean }) =>
      (await client.patch<CustomFieldDefinition>(`/api/custom-fields/${id}`, values)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useLeadCustomFieldValues(leadId: string) {
  return useQuery({
    queryKey: ['lead-custom-fields', leadId],
    queryFn: async () => (await client.get<{ values: Record<string, unknown> }>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`)).data.values,
    enabled: Boolean(leadId),
  })
}

export function useUpdateLeadCustomFieldValues(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: Record<string, unknown>) =>
      (await client.patch<{ values: Record<string, unknown> }>(`/api/custom-fields/lead-values/${encodeURIComponent(leadId)}`, { values })).data.values,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-custom-fields', leadId] }),
  })
}
