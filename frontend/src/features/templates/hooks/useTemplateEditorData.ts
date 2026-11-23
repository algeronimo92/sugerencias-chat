import { useMediaLibrary } from '../../media/public/queries'
import type { MediaAsset } from '../../media/types'
import { copyOfTemplate } from '../domain/templateDraft'
import type { TemplateFormState } from '../domain/templateForm'
import type { MessageTemplate, TemplateCapabilities, TemplateCategory } from '../types'
import { useTemplateCategories } from './useTemplateCategories'
import { useTemplateCapabilities, useTemplates } from './useTemplates'

export type TemplateEditorData =
  | { status: 'loading' }
  | { status: 'missing' }
  | {
    status: 'ready'
    template: MessageTemplate | undefined
    /** Punto de partida de una plantilla nueva que copia a otra. */
    seed: TemplateFormState | undefined
    /** Cambia cuando el editor tiene que arrancar de cero. */
    key: string
    templates: MessageTemplate[]
    categories: TemplateCategory[]
    capabilities: TemplateCapabilities | undefined
    mediaAssets: MediaAsset[]
  }

interface Options {
  /** El id de la ruta; sin él se crea una plantilla nueva. */
  templateId: number | null
  /** «Duplicar»: la plantilla que se copia. */
  copyOf: number | undefined
  /** Lo manda el editor cuando hay que volver a leer la plantilla guardada. */
  reload: number | undefined
}

/**
 * Lo que el editor necesita antes de mostrarse. Espera a categorías y
 * límites para que el formulario arranque completo: la categoría por defecto
 * y el tope de cada campo salen de ahí.
 */
export function useTemplateEditorData({ templateId, copyOf, reload }: Options): TemplateEditorData {
  const templates = useTemplates(true)
  const categories = useTemplateCategories()
  const capabilities = useTemplateCapabilities()
  const { data: mediaAssets = [] } = useMediaLibrary()

  if (templates.isLoading || categories.isLoading || capabilities.isLoading) return { status: 'loading' }

  const all = templates.data ?? []
  const template = templateId == null ? undefined : all.find(item => item.id === templateId)
  if (templateId != null && !template) return { status: 'missing' }

  const source = templateId == null && copyOf != null ? all.find(item => item.id === copyOf) : undefined
  const origin = templateId ?? (source ? `copy-${source.id}` : 'new')
  return {
    status: 'ready',
    template,
    seed: source ? copyOfTemplate(source) : undefined,
    key: `${origin}-${reload ?? ''}`,
    templates: all,
    categories: categories.data ?? [],
    capabilities: capabilities.data,
    mediaAssets,
  }
}
