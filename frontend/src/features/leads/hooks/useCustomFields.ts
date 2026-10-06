import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCustomField, fetchCustomFields, fetchLeadCustomFieldValues, updateCustomField, updateLeadCustomFieldValues } from '../api'
import type { CustomFieldEntity } from '../types'

export type { CustomFieldEntity, CustomFieldType } from '../types'

export type { CustomFieldDefinition } from '../types'

export function useCustomFields(entityType: CustomFieldEntity, includeInactive = false) {
  return useQuery({
    queryKey: ['custom-fields', entityType, { includeInactive }],
    queryFn: () => fetchCustomFields(entityType, includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createCustomField,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateCustomField,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useLeadCustomFieldValues(leadId: string) {
  return useQuery({
    queryKey: ['lead-custom-fields', leadId],
    queryFn: () => fetchLeadCustomFieldValues(leadId),
    enabled: Boolean(leadId),
  })
}

export function useUpdateLeadCustomFieldValues(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => updateLeadCustomFieldValues(leadId, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-custom-fields', leadId] }),
  })
}
