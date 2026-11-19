import type { ContactFilters, ImportRowStatus } from './types'

export const contactKeys = {
  all: ['contacts'] as const,
  list: (filters: ContactFilters, page: number) => ['contacts', 'list', filters, page] as const,
  tags: ['contacts', 'tags'] as const,
  imports: ['contact-imports'] as const,
  importList: ['contact-imports', 'list'] as const,
  import: (batchId: string) => ['contact-imports', batchId] as const,
  importRows: (batchId: string, status: ImportRowStatus, search: string, page: number) =>
    ['contact-imports', batchId, 'rows', status, search, page] as const,
  whatsappSync: ['contact-imports', 'whatsapp-sync'] as const,
}
