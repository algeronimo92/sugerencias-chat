import { useMutation } from '@tanstack/react-query'
import client from '../api/client'

interface TtsResult {
  contentType: string
  dataBase64: string
}

async function generateSpeech(text: string): Promise<TtsResult> {
  const { data } = await client.post<{ content_type: string; data_base64: string }>('/api/tts', { text })
  return { contentType: data.content_type, dataBase64: data.data_base64 }
}

export function useGenerateSpeech() {
  return useMutation({
    mutationFn: generateSpeech,
  })
}
