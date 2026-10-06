import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAiProfile, fetchAiUsage, deleteKnowledgeDocument, fetchKnowledgeDocument, fetchKnowledgeDocuments, saveAiProfile, saveKnowledgeDocument, setAiResourceDescription } from './api'

const PROFILE_KEY = ['ai-assistant', 'profile'] as const
const KNOWLEDGE_KEY = ['ai-assistant', 'knowledge'] as const

/** Habilitación y cuota del mes; la deciden en la plataforma. */
export function useAiUsage() {
  return useQuery({
    queryKey: ['ai-assistant', 'usage'],
    queryFn: fetchAiUsage,
    staleTime: 60_000,
  })
}

export function useAiProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: fetchAiProfile,
  })
}

export function useSaveAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveAiProfile,
    onSuccess: data => queryClient.setQueryData(PROFILE_KEY, data),
  })
}

export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: KNOWLEDGE_KEY,
    queryFn: fetchKnowledgeDocuments,
  })
}

export function useKnowledgeDocument(id: string | null) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, id],
    queryFn: () => fetchKnowledgeDocument(id),
    enabled: !!id,
  })
}

export function useSaveKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveKnowledgeDocument,
    onSuccess: data => {
      queryClient.setQueryData([...KNOWLEDGE_KEY, data.id], data)
      return queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY, exact: true })
    },
  })
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteKnowledgeDocument,
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
    mutationFn: setAiResourceDescription,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}
