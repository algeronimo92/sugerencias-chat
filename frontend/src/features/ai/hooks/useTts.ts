import { useMutation } from '@tanstack/react-query'
import { generateSpeech } from '../api'





export function useGenerateSpeech() {
  return useMutation({
    mutationFn: generateSpeech,
  })
}
