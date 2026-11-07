import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAiProfile, fetchAiUsage, deleteKnowledgeDocument, fetchKnowledgeDocument, fetchKnowledgeDocuments, saveAiProfile, saveKnowledgeDocument, setAiResourceDescription, importKnowledgePdf, fetchKnowledgeTemplates, importKnowledgeTemplate } from './api'
import { mediaKeys } from '../media/public/keys'
import type { MediaAsset } from '../media/types'
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
    // Optimista: la etiqueta "Visible / Oculto" cambia al instante en vez de
    // esperar el refetch de la biblioteca (mismo patrón que useDeleteMediaAsset).
    onMutate: async ({ id, description }) => {
      await queryClient.cancelQueries({ queryKey: mediaKeys.all })
      const previous = queryClient.getQueriesData<MediaAsset[]>({ queryKey: mediaKeys.all })
      queryClient.setQueriesData<MediaAsset[]>({ queryKey: mediaKeys.all }, current =>
        current?.map(asset => (asset.id === id ? { ...asset, ai_description: description.trim() || null } : asset)),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      context?.previous.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

export function useImportKnowledgePdf() {
  return useMutation({ mutationFn: importKnowledgePdf })
}

export function useKnowledgeTemplates(enabled: boolean) {
  return useQuery({ queryKey: aiKeys.knowledgeTemplates, queryFn: fetchKnowledgeTemplates, enabled })
}

export function useImportKnowledgeTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: importKnowledgeTemplate,
    onSuccess: data => {
      queryClient.setQueryData(aiKeys.knowledge(data.id), data)
      queryClient.invalidateQueries({ queryKey: aiKeys.knowledgeTemplates })
      return queryClient.invalidateQueries({ queryKey: aiKeys.knowledgeAll, exact: true })
    },
  })
}
