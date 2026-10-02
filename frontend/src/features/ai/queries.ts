import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { requestAiProfile,requestAiUsage,requestDeleteKnowledgeDocument,requestKnowledgeDocument,requestKnowledgeDocuments,requestSaveAiProfile,requestSaveKnowledgeDocument,requestSetAiResourceDescription } from './api'

const PROFILE_KEY = ['ai-assistant', 'profile'] as const
const KNOWLEDGE_KEY = ['ai-assistant', 'knowledge'] as const

/** Habilitación y cuota del mes; la deciden en la plataforma. */
export function useAiUsage() {
  return useQuery({
    queryKey: ['ai-assistant', 'usage'],
    queryFn: requestAiUsage(),
    staleTime: 60_000,
  })
}

export function useAiProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: requestAiProfile(),
  })
}

export function useSaveAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestSaveAiProfile(),
    onSuccess: data => queryClient.setQueryData(PROFILE_KEY, data),
  })
}

export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: KNOWLEDGE_KEY,
    queryFn: requestKnowledgeDocuments(),
  })
}

export function useKnowledgeDocument(id: string | null) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, id],
    queryFn: requestKnowledgeDocument(id),
    enabled: !!id,
  })
}

export function useSaveKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestSaveKnowledgeDocument(),
    onSuccess: data => {
      queryClient.setQueryData([...KNOWLEDGE_KEY, data.id], data)
      return queryClient.invalidateQueries({ queryKey: KNOWLEDGE_KEY, exact: true })
    },
  })
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestDeleteKnowledgeDocument(),
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
    mutationFn: requestSetAiResourceDescription(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}
