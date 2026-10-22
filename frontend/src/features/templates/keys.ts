export const templateKeys = {
  all: ['templates'] as const,
  list: (includeInactive: boolean) => ['templates', includeInactive] as const,
  capabilities: ['template-capabilities'] as const,
  metaAll: ['meta-templates'] as const,
  meta: (metaTemplateId: string | null) => ['meta-templates', metaTemplateId] as const,
  categoriesAll: ['template-categories'] as const,
  categories: (includeInactive: boolean) => ['template-categories', { includeInactive }] as const,
}
