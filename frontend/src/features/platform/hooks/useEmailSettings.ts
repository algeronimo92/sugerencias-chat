import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clearEmailSettings, fetchEmailSettings, saveEmailSettings, sendEmailTest } from '../api'
import { settingsKeys } from '../keys'
import type { EmailSettingsStatus } from '../types'

export type { EmailSettingsPayload, EmailSettingsStatus } from '../types'

export function useEmailSettings() {
  return useQuery({ queryKey: settingsKeys.email, queryFn: fetchEmailSettings })
}

function useStatusMutation<T>(mutationFn: (value: T) => Promise<EmailSettingsStatus>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (status) => queryClient.setQueryData(settingsKeys.email, status),
  })
}

export function useSaveEmailSettings() {
  return useStatusMutation(saveEmailSettings)
}

export function useClearEmailSettings() {
  return useStatusMutation<void>(() => clearEmailSettings())
}

export function useSendEmailTest() {
  return useMutation({ mutationFn: sendEmailTest })
}
