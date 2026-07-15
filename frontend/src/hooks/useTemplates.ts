import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { MessageTemplate, TemplateAttachment, TemplateCapabilities } from '../types'

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
  official_status: MessageTemplate['official_status']
  official_parameter_values: string[]
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      queryClient.invalidateQueries({ queryKey: ['media-library'] })
    },
  })
}
