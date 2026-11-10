import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchTtsStatus, generateSpeech } from '../api'
import { aiKeys } from '../keys'

export function useGenerateSpeech() {
  return useMutation({
    mutationFn: generateSpeech,
  })
}

/** Para avisar antes de intentar generar un audio sin ElevenLabs conectado. */
export function useTtsStatus() {
  return useQuery({
    queryKey: aiKeys.ttsStatus,
    queryFn: fetchTtsStatus,
    staleTime: 60_000,
  })
}
