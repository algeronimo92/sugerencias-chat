import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCustomField, fetchCustomFields, fetchLeadCustomFieldValues, updateCustomField, updateLeadCustomFieldValues } from '../api'
import type { CustomFieldEntity } from '../types'
import { customFieldKeys } from '../keys'

export type { CustomFieldEntity, CustomFieldType } from '../types'

export type { CustomFieldDefinition } from '../types'

export function useCustomFields(entityType: CustomFieldEntity, includeInactive = false) {
  return useQuery({
    queryKey: customFieldKeys.list(entityType, includeInactive),
    queryFn: () => fetchCustomFields(entityType, includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createCustomField,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customFieldKeys.all }),
  })
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateCustomField,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customFieldKeys.all }),
  })
}

export function useLeadCustomFieldValues(leadId: string) {
  return useQuery({
    queryKey: customFieldKeys.leadValues(leadId),
    queryFn: () => fetchLeadCustomFieldValues(leadId),
    enabled: Boolean(leadId),
  })
}

export function useUpdateLeadCustomFieldValues(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => updateLeadCustomFieldValues(leadId, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customFieldKeys.leadValues(leadId) }),
  })
}
