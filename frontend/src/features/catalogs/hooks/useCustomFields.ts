import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCustomField, fetchCustomFields, updateCustomField } from '../api'
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
