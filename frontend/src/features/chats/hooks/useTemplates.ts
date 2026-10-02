import { useMutation,useQuery } from '@tanstack/react-query'
import { queryClient } from '../../../shared/queryClient'
import { requestAddLibraryTemplateAttachment,requestCreatePersonalTemplate,requestCreateTemplate,requestDeleteTemplate,requestDeleteTemplateAttachment,requestImportMetaTemplate,requestMetaTemplateDetail,requestMetaTemplates,requestRecordTemplateUse,requestSyncTemplate,requestTemplateCapabilities,requestTemplates,requestToggleTemplateFavorite,requestUpdateTemplate,requestUploadTemplateAttachment } from '../api'

export type { TemplateInput } from '../types'

export function useTemplates(includeInactive = false) {
  return useQuery({
    queryKey: ['templates', includeInactive],
    queryFn: requestTemplates(includeInactive),
    // El composer de cada chat la monta: sin esto se repedía al cambiar de
    // chat. Las ediciones llegan por templates_updated y por las mutaciones.
    staleTime: 5 * 60_000,
  })
}

export function useTemplateCapabilities() {
  return useQuery({
    queryKey: ['template-capabilities'],
    queryFn: requestTemplateCapabilities(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useCreateTemplate() {
  return useMutation({
    mutationFn: requestCreateTemplate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUpdateTemplate() {
  return useMutation({
    mutationFn: requestUpdateTemplate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useCreatePersonalTemplate() {
  return useMutation({
    mutationFn: requestCreatePersonalTemplate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useToggleTemplateFavorite() {
  return useMutation({
    mutationFn: requestToggleTemplateFavorite(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useRecordTemplateUse() {
  return useMutation({
    mutationFn: requestRecordTemplateUse(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUploadTemplateAttachment() {
  return useMutation({
    mutationFn: requestUploadTemplateAttachment(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}

export function useAddLibraryTemplateAttachment() {
  return useMutation({
    mutationFn: requestAddLibraryTemplateAttachment(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}

export function useDeleteTemplateAttachment() {
  return useMutation({
    mutationFn: requestDeleteTemplateAttachment(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['templates'] }),
        queryClient.invalidateQueries({ queryKey: ['media-library'] }),
      ])
    },
  })
}

/** Plantillas tal cual existen del lado de Meta, incluidas las creadas desde
 * el WhatsApp Manager que todavía no se vincularon a la app. Deshabilitado
 * hasta que se pida (el diálogo de importación lo abre a demanda). */
export function useMetaTemplates(enabled: boolean) {
  return useQuery({
    queryKey: ['meta-templates'],
    queryFn: requestMetaTemplates(),
    enabled,
  })
}

export function useMetaTemplateDetail(metaTemplateId: string | null) {
  return useQuery({
    queryKey: ['meta-templates', metaTemplateId],
    queryFn: requestMetaTemplateDetail(metaTemplateId),
    enabled: metaTemplateId != null,
  })
}

export function useImportMetaTemplate() {
  return useMutation({
    mutationFn: requestImportMetaTemplate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useSyncTemplate() {
  return useMutation({
    mutationFn: requestSyncTemplate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useDeleteTemplate() {
  return useMutation({
    mutationFn: requestDeleteTemplate(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}
