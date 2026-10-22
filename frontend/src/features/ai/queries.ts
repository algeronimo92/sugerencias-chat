import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAiProfile, fetchAiUsage, deleteKnowledgeDocument, fetchKnowledgeDocument, fetchKnowledgeDocuments, saveAiProfile, saveKnowledgeDocument, setAiResourceDescription } from './api'
import { mediaKeys } from '../media/public/keys'
import { aiKeys } from './keys'


/** Habilitación y cuota del mes; la deciden en la plataforma. */
export function useAiUsage() {
  return useQuery({
    queryKey: aiKeys.usage,
    queryFn: fetchAiUsage,
    staleTime: 60_000,
  })
}

export function useAiProfile() {
  return useQuery({
    queryKey: aiKeys.profile,
    queryFn: fetchAiProfile,
  })
}

export function useSaveAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveAiProfile,
    onSuccess: data => queryClient.setQueryData(aiKeys.profile, data),
  })
}

export function useKnowledgeDocuments() {
  return useQuery({
    queryKey: aiKeys.knowledgeAll,
    queryFn: fetchKnowledgeDocuments,
  })
}

export function useKnowledgeDocument(id: string | null) {
  return useQuery({
    queryKey: aiKeys.knowledge(id),
    queryFn: () => fetchKnowledgeDocument(id),
    enabled: !!id,
  })
}

export function useSaveKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveKnowledgeDocument,
    onSuccess: data => {
      queryClient.setQueryData(aiKeys.knowledge(data.id), data)
      return queryClient.invalidateQueries({ queryKey: aiKeys.knowledgeAll, exact: true })
    },
  })
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteKnowledgeDocument,
    onSuccess: (_data, id) => {
      // Sin esto el detalle del documento borrado se refetchea y da 404.
      queryClient.removeQueries({ queryKey: aiKeys.knowledge(id) })
      return queryClient.invalidateQueries({ queryKey: aiKeys.knowledgeAll, exact: true })
    },
  })
}

export function useSetAiResourceDescription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setAiResourceDescription,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}
