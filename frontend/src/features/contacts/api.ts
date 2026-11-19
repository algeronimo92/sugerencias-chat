import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type {
  Contact, ContactCreateInput, ContactFilters, ContactPage, ContactUpdateInput, CsvColumnMapping, CsvPreview,
  ImportResult, ImportRowPage, ImportRowStatus, ImportSelection, ImportSummary, WhatsAppSyncStatus,
} from './types'

export const CONTACTS_PAGE_SIZE = 50
export const IMPORT_ROWS_PAGE_SIZE = 50
/** Mismo tope que el servidor (contacts/csv_reader.MAX_BYTES). */
export const MAX_CSV_BYTES = 5 * 1024 * 1024

function yesNo(value: '' | 'yes' | 'no'): boolean | undefined {
  return value === '' ? undefined : value === 'yes'
}

export async function fetchContacts(filters: ContactFilters, page: number): Promise<ContactPage> {
  return (await client.get<ApiResponse<'/api/contacts', 'get'>>('/api/contacts', {
    params: {
      search: filters.search.trim() || undefined,
      origen: filters.origen || undefined,
      tag: filters.tag || undefined,
      has_lead: yesNo(filters.hasLead),
      consent: yesNo(filters.consent),
      removed_in_app: filters.removedInApp || undefined,
      offset: page * CONTACTS_PAGE_SIZE,
      limit: CONTACTS_PAGE_SIZE,
    },
  })).data
}

export async function fetchContactTags(): Promise<string[]> {
  return (await client.get<ApiResponse<'/api/contacts/tags', 'get'>>('/api/contacts/tags')).data
}

export async function createContact(input: ContactCreateInput): Promise<Contact> {
  return (await client.post<ApiResponse<'/api/contacts', 'post'>>('/api/contacts', input)).data
}

export async function updateContact({ id, ...values }: ContactUpdateInput & { id: string }): Promise<Contact> {
  return (await client.patch<ApiResponse<'/api/contacts/{contact_id}', 'patch'>>(`/api/contacts/${id}`, values)).data
}

export async function deleteContacts(ids: string[]): Promise<{ count: number }> {
  return (await client.post<ApiResponse<'/api/contacts/bulk/delete', 'post'>>('/api/contacts/bulk/delete', { ids })).data
}

export async function changeContactTags(input: { ids: string[]; add: string[]; remove: string[] }): Promise<{ count: number }> {
  return (await client.post<ApiResponse<'/api/contacts/bulk/tags', 'post'>>('/api/contacts/bulk/tags', input)).data
}

export async function promoteContact(id: string): Promise<{ lead_id: string }> {
  return (await client.post<ApiResponse<'/api/contacts/{contact_id}/lead', 'post'>>(`/api/contacts/${id}/lead`)).data
}

export async function promoteContacts(ids: string[]): Promise<{ promoted: number; failed: number }> {
  return (await client.post<ApiResponse<'/api/contacts/bulk/leads', 'post'>>('/api/contacts/bulk/leads', { ids })).data
}

/* ---------------------------------------------------------- importaciones */

/** El archivo en base64, como viajan todas las subidas del CRM. */
export async function encodeFileContent(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // Por tramos: String.fromCharCode con el archivo entero desborda la pila.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export async function previewCsv(input: { fileName: string; dataBase64: string }): Promise<CsvPreview> {
  return (await client.post<ApiResponse<'/api/contacts/imports/csv/preview', 'post'>>(
    '/api/contacts/imports/csv/preview', { file_name: input.fileName, data_base64: input.dataBase64 },
  )).data
}

export async function createCsvImport(input: {
  fileName: string; dataBase64: string; mapping: CsvColumnMapping
}): Promise<ImportSummary> {
  return (await client.post<ApiResponse<'/api/contacts/imports/csv', 'post'>>('/api/contacts/imports/csv', {
    file_name: input.fileName, data_base64: input.dataBase64, mapping: input.mapping,
  })).data
}

export async function fetchImports(): Promise<ImportSummary[]> {
  return (await client.get<ApiResponse<'/api/contacts/imports', 'get'>>('/api/contacts/imports')).data
}

export async function fetchImport(batchId: string): Promise<ImportSummary> {
  return (await client.get<ApiResponse<'/api/contacts/imports/{batch_id}', 'get'>>(`/api/contacts/imports/${batchId}`)).data
}

export async function fetchImportRows(
  batchId: string, status: ImportRowStatus, search: string, page: number,
): Promise<ImportRowPage> {
  return (await client.get<ApiResponse<'/api/contacts/imports/{batch_id}/rows', 'get'>>(
    `/api/contacts/imports/${batchId}/rows`,
    { params: { status, search: search.trim() || undefined, offset: page * IMPORT_ROWS_PAGE_SIZE, limit: IMPORT_ROWS_PAGE_SIZE } },
  )).data
}

export async function confirmImport({ batchId, ...selection }: ImportSelection & { batchId: string }): Promise<ImportResult> {
  return (await client.post<ApiResponse<'/api/contacts/imports/{batch_id}/confirm', 'post'>>(
    `/api/contacts/imports/${batchId}/confirm`, selection,
  )).data
}

export async function discardImport(batchId: string): Promise<void> {
  await client.post<ApiResponse<'/api/contacts/imports/{batch_id}/discard', 'post'>>(`/api/contacts/imports/${batchId}/discard`)
}

/* ---------------------------------------------- sincronización del celular */

export async function fetchWhatsAppSync(): Promise<WhatsAppSyncStatus> {
  return (await client.get<ApiResponse<'/api/contacts/whatsapp-sync', 'get'>>('/api/contacts/whatsapp-sync')).data
}

export async function setWhatsAppAutoImport(autoImport: boolean): Promise<WhatsAppSyncStatus> {
  return (await client.put<ApiResponse<'/api/contacts/whatsapp-sync/settings', 'put'>>(
    '/api/contacts/whatsapp-sync/settings', { auto_import: autoImport },
  )).data
}

export async function retryWhatsAppSync(): Promise<{ retried: string[] }> {
  return (await client.post<ApiResponse<'/api/settings/meta/app-sync/retry', 'post'>>('/api/settings/meta/app-sync/retry')).data
}
