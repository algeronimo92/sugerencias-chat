import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { completeMetaEmbeddedSignup,fetchMetaPublicConfig,fetchSettings,fetchBusinessTimezones,saveSettings } from '../api'



export function useSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    enabled,
  })
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

export type { BusinessTimezoneItem } from '../types'

export function useBusinessTimezones(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'timezones'],
    queryFn: fetchBusinessTimezones,
    enabled,
    staleTime: 60 * 60 * 1000,
  })
}

export type { MetaPublicConfig } from '../types'



export function useMetaPublicConfig() {
  return useQuery({
    queryKey: ['platform-meta-public-config'],
    queryFn: fetchMetaPublicConfig,
  })
}

export type { MetaEmbeddedSignupPayload } from '../types'



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
