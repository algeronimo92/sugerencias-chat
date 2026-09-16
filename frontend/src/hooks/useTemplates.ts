import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { MessageTemplate, MetaTemplateRaw, TemplateAttachment, TemplateCapabilities } from '../types'

export interface TemplateInput {
  name: string
  content: string
  shortcut: string | null
  category: string
  stage: MessageTemplate['stage']
  task_type: MessageTemplate['task_type']
  service: string | null
  template_type: MessageTemplate['template_type']
  official_name: string | null
  official_language: string | null
  official_category: MessageTemplate['official_category']
  official_status?: MessageTemplate['official_status']
  official_parameter_values: string[]
  official_header_type: MessageTemplate['official_header_type']
  official_header_text: string | null
  official_header_media_asset_id: number | null
  official_footer: string | null
  official_buttons: MessageTemplate['official_buttons']
  interactive_type: MessageTemplate['interactive_type']
  interactive_config: MessageTemplate['interactive_config']
}

export function useTemplates(includeInactive = false) {
  return useQuery({
    queryKey: ['templates', includeInactive],
    queryFn: async () => (await client.get<MessageTemplate[]>('/api/templates', { params: { include_inactive: includeInactive } })).data,
  })
}

export function useTemplateCapabilities() {
  return useQuery({
    queryKey: ['template-capabilities'],
    queryFn: async () => (await client.get<TemplateCapabilities>('/api/templates/capabilities')).data,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useCreateTemplate() {
  return useMutation({
    mutationFn: async (input: TemplateInput) => (await client.post<MessageTemplate>('/api/templates', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUpdateTemplate() {
  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<MessageTemplate> & { id: number }) => (await client.patch<MessageTemplate>(`/api/templates/${id}`, input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useCreatePersonalTemplate() {
  return useMutation({
    mutationFn: async (input: { name: string; content: string; shortcut?: string | null }) =>
      (await client.post<MessageTemplate>('/api/templates/personal', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useToggleTemplateFavorite() {
  return useMutation({
    mutationFn: async ({ id, isFavorite }: { id: number; isFavorite: boolean }) => {
      await client.put(`/api/templates/${id}/favorite`, { is_favorite: isFavorite })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useRecordTemplateUse() {
  return useMutation({
    mutationFn: async (id: number) => { await client.post(`/api/templates/${id}/use`) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useUploadTemplateAttachment() {
  return useMutation({
    mutationFn: async ({ templateId, contentType, dataBase64, filename }: { templateId: number; contentType: string; dataBase64: string; filename: string }) =>
      (await client.post<TemplateAttachment>(`/api/templates/${templateId}/attachments`, {
        content_type: contentType, data_base64: dataBase64, filename,
      })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}

export function useAddLibraryTemplateAttachment() {
  return useMutation({
    mutationFn: async ({ templateId, assetId }: { templateId: number; assetId: number }) =>
      (await client.post<TemplateAttachment>(`/api/templates/${templateId}/attachments/library`, {
        asset_id: assetId,
      })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}

export function useDeleteTemplateAttachment() {
  return useMutation({
    mutationFn: async (id: number) => { await client.delete(`/api/templates/attachments/${id}`) },
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
    queryFn: async () => (await client.get<MetaTemplateRaw[]>('/api/templates/meta')).data,
    enabled,
  })
}

export function useMetaTemplateDetail(metaTemplateId: string | null) {
  return useQuery({
    queryKey: ['meta-templates', metaTemplateId],
    queryFn: async () => (await client.get<MetaTemplateRaw>(`/api/templates/meta/${metaTemplateId}`)).data,
    enabled: metaTemplateId != null,
  })
}

export function useImportMetaTemplate() {
  return useMutation({
    mutationFn: async ({ metaTemplateId, name, category, shortcut, officialParameterValues }: {
      metaTemplateId: string
      name: string
      category: string
      shortcut: string | null
      officialParameterValues: string[]
    }) => (await client.post<MessageTemplate>(`/api/templates/meta/${metaTemplateId}/import`, {
      name, category, shortcut, official_parameter_values: officialParameterValues,
    })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useSyncTemplate() {
  return useMutation({
    mutationFn: async (id: number) => (await client.post<MessageTemplate>(`/api/templates/${id}/sync`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}

export function useDeleteTemplate() {
  return useMutation({
    mutationFn: async (id: number) => { await client.delete(`/api/templates/${id}`) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })
}
