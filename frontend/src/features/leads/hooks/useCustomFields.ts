import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestCreateCustomField,requestCustomFields,requestLeadCustomFieldValues,requestUpdateCustomField,requestUpdateLeadCustomFieldValues } from '../api'
import type { CustomFieldEntity } from '../types'

export type { CustomFieldEntity,CustomFieldType } from '../types'

export type { CustomFieldDefinition } from '../types'

export function useCustomFields(entityType: CustomFieldEntity, includeInactive = false) {
  return useQuery({
    queryKey: ['custom-fields', entityType, { includeInactive }],
    queryFn: requestCustomFields(entityType, includeInactive),
    staleTime: 60_000,
  })
}

export function useCreateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestCreateCustomField(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestUpdateCustomField(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  })
}

export function useLeadCustomFieldValues(leadId: string) {
  return useQuery({
    queryKey: ['lead-custom-fields', leadId],
    queryFn: requestLeadCustomFieldValues(leadId),
    enabled: Boolean(leadId),
  })
}

export function useUpdateLeadCustomFieldValues(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestUpdateLeadCustomFieldValues(leadId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-custom-fields', leadId] }),
  })
}
