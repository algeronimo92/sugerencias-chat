import client from '../../shared/http/client'
import { jsonAs, type ApiResponse } from '../../shared/http/contract'
import type { ContractMessageTemplate, ContractMetaTemplate, MessageTemplate, MetaTemplateComponent, MetaTemplateRaw, OfficialTemplateButton, TemplateAttachment, TemplateCapabilities, TemplateCategory, TemplateInput, TemplateInteractiveConfig } from './types'


/** De lo que entrega el contrato a la plantilla que usan las pantallas. */
export function toMessageTemplate(template: ContractMessageTemplate): MessageTemplate {
  return {
    ...template,
    official_buttons: template.official_buttons.map(button => jsonAs<OfficialTemplateButton>(button)),
    interactive_config: jsonAs<TemplateInteractiveConfig>(template.interactive_config),
  }
}

export async function fetchTemplates(includeInactive: boolean): Promise<MessageTemplate[]> {
  const { data } = await client.get<ApiResponse<'/api/templates', 'get'>>('/api/templates', { params: { include_inactive: includeInactive } })
  return data.map(toMessageTemplate)
}

export async function fetchTemplateCapabilities(): Promise<TemplateCapabilities> {
  return (await client.get<ApiResponse<'/api/templates/capabilities', 'get'>>('/api/templates/capabilities')).data
}

export async function createTemplate(input: TemplateInput): Promise<MessageTemplate> {
  const { data } = await client.post<ApiResponse<'/api/templates', 'post'>>('/api/templates', input)
  return toMessageTemplate(data)
}

export async function updateTemplate({ id, ...input }: Partial<MessageTemplate> & { id: number }): Promise<MessageTemplate> {
  const { data } = await client.patch<ApiResponse<'/api/templates/{template_id}', 'patch'>>(`/api/templates/${id}`, input)
  return toMessageTemplate(data)
}

export async function createPersonalTemplate(input: { name: string; content: string; shortcut?: string | null }): Promise<MessageTemplate> {
  const { data } = await client.post<ApiResponse<'/api/templates/personal', 'post'>>('/api/templates/personal', input)
  return toMessageTemplate(data)
}

export async function toggleTemplateFavorite({ id, isFavorite }: { id: number; isFavorite: boolean }) {
  await client.put<ApiResponse<'/api/templates/{template_id}/favorite', 'put'>>(`/api/templates/${id}/favorite`, { is_favorite: isFavorite })
}

export async function recordTemplateUse(id: number) { await client.post<ApiResponse<'/api/templates/{template_id}/use', 'post'>>(`/api/templates/${id}/use`) }

export async function uploadTemplateAttachment({ templateId, contentType, dataBase64, filename }: { templateId: number; contentType: string; dataBase64: string; filename: string }): Promise<TemplateAttachment> {
  return (await client.post<ApiResponse<'/api/templates/{template_id}/attachments', 'post'>>(`/api/templates/${templateId}/attachments`, {
        content_type: contentType, data_base64: dataBase64, filename,
      })).data
}

export async function addLibraryTemplateAttachment({ templateId, assetId }: { templateId: number; assetId: number }): Promise<TemplateAttachment> {
  return (await client.post<ApiResponse<'/api/templates/{template_id}/attachments/library', 'post'>>(`/api/templates/${templateId}/attachments/library`, {
        asset_id: assetId,
      })).data
}

export async function deleteTemplateAttachment(id: number) { await client.delete<ApiResponse<'/api/templates/attachments/{attachment_id}', 'delete'>>(`/api/templates/attachments/${id}`) }

function toMetaTemplate(template: ContractMetaTemplate): MetaTemplateRaw {
  return {
    id: template.id,
    name: template.name,
    status: template.status,
    category: template.category,
    language: template.language,
    rejected_reason: template.rejected_reason,
    components: template.components === null ? null : template.components.map(component => jsonAs<MetaTemplateComponent>(component)),
  }
}

export async function fetchMetaTemplates(): Promise<MetaTemplateRaw[]> {
  const { data } = await client.get<ApiResponse<'/api/templates/meta', 'get'>>('/api/templates/meta')
  return data.map(toMetaTemplate)
}

export async function fetchMetaTemplateDetail(metaTemplateId: string | null): Promise<MetaTemplateRaw> {
  const { data } = await client.get<ApiResponse<'/api/templates/meta/{meta_template_id}', 'get'>>(`/api/templates/meta/${metaTemplateId}`)
  return toMetaTemplate(data)
}

export async function importMetaTemplate({ metaTemplateId, name, category, shortcut, officialParameterValues }: {
      metaTemplateId: string
      name: string
      category: string
      shortcut: string | null
      officialParameterValues: string[]
    }): Promise<MessageTemplate> {
  const { data } = await client.post<ApiResponse<'/api/templates/meta/{meta_template_id}/import', 'post'>>(`/api/templates/meta/${metaTemplateId}/import`, {
      name, category, shortcut, official_parameter_values: officialParameterValues,
    })
  return toMessageTemplate(data)
}

export async function syncTemplate(id: number): Promise<MessageTemplate> {
  const { data } = await client.post<ApiResponse<'/api/templates/{template_id}/sync', 'post'>>(`/api/templates/${id}/sync`)
  return toMessageTemplate(data)
}

export async function deleteTemplate(id: number) { await client.delete<ApiResponse<'/api/templates/{template_id}', 'delete'>>(`/api/templates/${id}`) }

export async function fetchTemplateCategories(includeInactive: boolean): Promise<TemplateCategory[]> {
  if (includeInactive) return (await client.get<ApiResponse<'/api/template-categories/all', 'get'>>('/api/template-categories/all')).data
  return (await client.get<ApiResponse<'/api/template-categories', 'get'>>('/api/template-categories')).data
}

export async function createTemplateCategory(name: string): Promise<TemplateCategory> {
  return (
      await client.post<ApiResponse<'/api/template-categories', 'post'>>('/api/template-categories', { name })
    ).data
}

export async function updateTemplateCategory({ id, ...values }: { id: number; name?: string; is_active?: boolean }): Promise<TemplateCategory> {
  return (
      await client.patch<ApiResponse<'/api/template-categories/{category_id}', 'patch'>>(`/api/template-categories/${id}`, values)
    ).data
}
