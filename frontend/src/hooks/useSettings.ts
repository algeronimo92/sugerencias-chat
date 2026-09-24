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

export interface BusinessTimezoneItem {
  id: string
  label: string
  offset_minutes: number
}

export function useBusinessTimezones(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'timezones'],
    queryFn: async () => (
      await client.get<BusinessTimezoneItem[]>('/api/settings/timezones')
    ).data,
    enabled,
    staleTime: 60 * 60 * 1000,
  })
}

export interface MetaPublicConfig {
  app_id: string | null
  config_id: string | null
}

async function fetchMetaPublicConfig(): Promise<MetaPublicConfig> {
  const { data } = await client.get<MetaPublicConfig>('/api/settings/meta/public-config')
  return data
}

export function useMetaPublicConfig() {
  return useQuery({
    queryKey: ['platform-meta-public-config'],
    queryFn: fetchMetaPublicConfig,
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
      // El estado de WhatsApp se deriva de las credenciales de Meta: sin esto
      // el CTA de "conectá tu WhatsApp" sigue visible hasta el próximo refetch.
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] })
    },
  })
}
