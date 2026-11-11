import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clearEmailSettings, connectEmail, disconnectEmail, fetchEmailSettings, saveEmailSettings, sendEmailTest } from '../api'
import { settingsKeys } from '../keys'
import type { EmailOAuthProvider, EmailSettingsStatus } from '../types'

export type { EmailOAuthProvider, EmailSettingsPayload, EmailSettingsStatus } from '../types'

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

/** Pide la URL de consentimiento y deja la página: el proveedor vuelve al
 *  CRM con ?settings=email&email=... (lo lee app/layout.tsx). */
export function useConnectEmail() {
  return useMutation({
    mutationFn: (provider: EmailOAuthProvider) => connectEmail(provider, window.location.origin),
    onSuccess: (url) => window.location.assign(url),
  })
}

export function useDisconnectEmail() {
  return useStatusMutation<void>(() => disconnectEmail())
}
