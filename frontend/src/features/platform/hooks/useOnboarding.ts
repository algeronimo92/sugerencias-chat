import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dismissOnboarding, fetchOnboarding } from '../api'
import { settingsKeys } from '../keys'

export type { OnboardingStatus, OnboardingStepKey } from '../types'

/** Estado del checklist de primeros pasos. Solo admins: el endpoint lo exige. */
export function useOnboarding(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.onboarding,
    queryFn: fetchOnboarding,
    enabled,
    // Los pasos dependen de pantallas de otras features (catálogos, usuarios):
    // que se reconsulte al volver a la pestaña o al cambiar de ruta.
    staleTime: 0,
    retry: false,
  })
}

export function useDismissOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: dismissOnboarding,
    onSuccess: (status) => queryClient.setQueryData(settingsKeys.onboarding, status),
  })
}
