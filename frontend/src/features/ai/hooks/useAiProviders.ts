import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAiProviders, testAiProvider } from '../api'
import { aiKeys } from '../keys'

export function useAiProviders() {
  return useQuery({ queryKey: aiKeys.providers, queryFn: fetchAiProviders, staleTime: 30_000 })
}

export function useTestAiProvider() {
  return useMutation({ mutationFn: testAiProvider })
}

/** Tras guardar claves, modelos o el modo, el estado de la tarjeta cambia. */
export function useRefreshAiProviders() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: aiKeys.providers })
    queryClient.invalidateQueries({ queryKey: aiKeys.suggestionsAll })
  }
}
