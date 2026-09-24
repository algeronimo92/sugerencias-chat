import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { AIProfile, AIUsage, KnowledgeDocument, KnowledgeDocumentSummary, MediaAsset } from '../types'

const PROFILE_KEY = ['ai-assistant', 'profile'] as const
const KNOWLEDGE_KEY = ['ai-assistant', 'knowledge'] as const

/** Habilitación y cuota del mes; la deciden en la plataforma. */
export function useAiUsage() {
  return useQuery({
    queryKey: ['ai-assistant', 'usage'],
    queryFn: async () => (await client.get<AIUsage>('/api/suggestions/usage')).data,
    staleTime: 60_000,
  })
}

export function useAiProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async () => (await client.get<AIProfile>('/api/ai/profile')).data,
  })
}

export function useSaveAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (profile: Omit<AIProfile, 'updated_at'>) =>
      (await client.put<AIProfile>('/api/ai/profile', profile)).data,
    onSuccess: data => queryClient.setQueryData(PROFILE_KEY, data),
  })
}

export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: KNOWLEDGE_KEY,
    queryFn: async () => (await client.get<KnowledgeDocumentSummary[]>('/api/ai/knowledge')).data,
  })
}

export function useKnowledgeDocument(id: string | null) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, id],
    queryFn: async () => (await client.get<KnowledgeDocument>(`/api/ai/knowledge/${id}`)).data,
    enabled: !!id,
  })
}

export function useSaveKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, title, content }: { id: string | null; title: string; content: string }) =>
      id
        ? (await client.put<KnowledgeDocument>(`/api/ai/knowledge/${id}`, { title, content })).data
        : (await client.post<KnowledgeDocument>('/api/ai/knowledge', { title, content })).data,
    onSuccess: data => {
      queryClient.setQueryData([...KNOWLEDGE_KEY, data.id], data)
      return queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY, exact: true })
    },
  })
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => { await client.delete(`/api/ai/knowledge/${id}`) },
    onSuccess: (_data, id) => {
      // Sin esto el detalle del documento borrado se refetchea y da 404.
      queryClient.removeQueries({ queryKey: [...KNOWLEDGE_KEY, id] })
      return queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY, exact: true })
    },
  })
}

export function useSetAiResourceDescription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, description }: { id: number; description: string }) =>
      (await client.patch<MediaAsset>(`/api/ai/resources/${id}`, { ai_description: description })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}
