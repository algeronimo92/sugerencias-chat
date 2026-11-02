import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { completeMetaEmbeddedSignup, fetchMetaPublicConfig, fetchSettings, fetchBusinessTimezones, saveSettings } from '../api'
import { settingsKeys, whatsappKeys } from '../keys'

export function useSettings(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: fetchSettings,
    enabled,
  })
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.all, data)
    },
  })
}

export type { BusinessTimezoneItem } from '../types'

export function useBusinessTimezones(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.timezones,
    queryFn: fetchBusinessTimezones,
    enabled,
    staleTime: 60 * 60 * 1000,
  })
}

export type { MetaPublicConfig } from '../types'

export function useMetaPublicConfig() {
  return useQuery({
    queryKey: settingsKeys.metaPublicConfig,
    queryFn: fetchMetaPublicConfig,
  })
}

export type { MetaEmbeddedSignupPayload } from '../types'

export function useCompleteMetaEmbeddedSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: completeMetaEmbeddedSignup,
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.all, data)
    },
    // También tras un error: el backend guarda las credenciales antes de
    // responder, y un túnel o proxy puede cortar la respuesta aunque el
    // vínculo ya haya quedado hecho. El estado de WhatsApp se deriva de esas
    // credenciales: sin esto el CTA de "conectá tu WhatsApp" sigue visible.
    onSettled: (_data, error) => {
      if (error) queryClient.invalidateQueries({ queryKey: settingsKeys.all, exact: true })
      queryClient.invalidateQueries({ queryKey: whatsappKeys.status })
    },
  })
}
