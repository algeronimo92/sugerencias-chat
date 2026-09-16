import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { SettingItem } from '../types'

async function fetchSettings(): Promise<SettingItem[]> {
  const { data } = await client.get<SettingItem[]>('/api/settings')
  return data
}

export function useSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    enabled,
  })
}

async function saveSettings(values: Record<string, string>): Promise<SettingItem[]> {
  const { data } = await client.put<SettingItem[]>('/api/settings', { values })
  return data
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data)
    },
  })
}

export interface MetaEmbeddedSignupPayload {
  code: string
  waba_id: string
  // Ausente en coexistencia con la app de WhatsApp Business (ver WhatsappPanel.tsx).
  phone_number_id?: string
}

async function completeMetaEmbeddedSignup(payload: MetaEmbeddedSignupPayload): Promise<SettingItem[]> {
  const { data } = await client.post<SettingItem[]>('/api/settings/meta/embedded-signup', payload)
  return data
}

export function useCompleteMetaEmbeddedSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: completeMetaEmbeddedSignup,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data)
    },
  })
}
