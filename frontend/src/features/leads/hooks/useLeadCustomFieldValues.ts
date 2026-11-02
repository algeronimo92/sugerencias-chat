import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchLeadCustomFieldValues, updateLeadCustomFieldValues } from '../api'
import { leadKeys } from '../keys'

export function useLeadCustomFieldValues(leadId: string) {
  return useQuery({
    queryKey: leadKeys.customFieldValues(leadId),
    queryFn: () => fetchLeadCustomFieldValues(leadId),
    enabled: Boolean(leadId),
  })
}

export function useUpdateLeadCustomFieldValues(leadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: Record<string, unknown>) => updateLeadCustomFieldValues(leadId, values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: leadKeys.customFieldValues(leadId) }),
  })
}
