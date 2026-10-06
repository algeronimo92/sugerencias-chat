import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../../shared/queryClient'
import { addLibraryTemplateAttachment, createPersonalTemplate, createTemplate, deleteTemplate, deleteTemplateAttachment, importMetaTemplate, fetchMetaTemplateDetail, fetchMetaTemplates, recordTemplateUse, syncTemplate, fetchTemplateCapabilities, fetchTemplates, toggleTemplateFavorite, updateTemplate, uploadTemplateAttachment } from '../api'

export type { TemplateInput } from '../types'

export function useTemplates(includeInactive = false) {
  return useQuery({
    queryKey: ['templates', includeInactive],
    queryFn: () => fetchTemplates(includeInactive),
    // El composer de cada chat la monta: sin esto se repedía al cambiar de
    // chat. Las ediciones llegan por templates_updated y por las mutaciones.
    staleTime: 5 * 60_000,
  })
}

export function useTemplateCapabilities() {
  return useQuery({
    queryKey: ['template-capabilities'],
    queryFn: fetchTemplateCapabilities,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useCreateTemplate() {
  return useMutation({
    mutationFn: createTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUpdateTemplate() {
  return useMutation({
    mutationFn: updateTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useCreatePersonalTemplate() {
  return useMutation({
    mutationFn: createPersonalTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useToggleTemplateFavorite() {
  return useMutation({
    mutationFn: toggleTemplateFavorite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useRecordTemplateUse() {
  return useMutation({
    mutationFn: recordTemplateUse,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUploadTemplateAttachment() {
  return useMutation({
    mutationFn: uploadTemplateAttachment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}

export function useAddLibraryTemplateAttachment() {
  return useMutation({
    mutationFn: addLibraryTemplateAttachment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}

export function useDeleteTemplateAttachment() {
  return useMutation({
    mutationFn: deleteTemplateAttachment,
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
    queryFn: fetchMetaTemplates,
    enabled,
  })
}

export function useMetaTemplateDetail(metaTemplateId: string | null) {
  return useQuery({
    queryKey: ['meta-templates', metaTemplateId],
    queryFn: () => fetchMetaTemplateDetail(metaTemplateId),
    enabled: metaTemplateId != null,
  })
}

export function useImportMetaTemplate() {
  return useMutation({
    mutationFn: importMetaTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useSyncTemplate() {
  return useMutation({
    mutationFn: syncTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useDeleteTemplate() {
  return useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}
