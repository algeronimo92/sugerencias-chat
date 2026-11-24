import type { ApiSchemas } from '../../shared/http/contract'

export type Contact = ApiSchemas['ContactItem']
export type ContactPage = ApiSchemas['ContactPage']
export type ContactOrigin = Contact['origen']
export type ContactCreateInput = ApiSchemas['ContactCreate']
export type ContactUpdateInput = ApiSchemas['ContactUpdate']

export type CsvPreview = ApiSchemas['CsvPreview']
export type CsvColumnMapping = ApiSchemas['CsvColumnMapping']
export type CsvField = keyof CsvColumnMapping
export type ImportSummary = ApiSchemas['ImportSummary']
export type ImportRow = ApiSchemas['ImportRowItem']
export type ImportRowPage = ApiSchemas['ImportRowPage']
export type ImportSelection = ApiSchemas['ImportSelection']
export type ImportResult = ApiSchemas['ImportResult']
export type ImportRowStatus = 'pending' | 'invalid' | 'processed'

export type WhatsAppSyncStatus = ApiSchemas['WhatsAppSyncStatus']
export type WhatsAppSyncItem = ApiSchemas['WhatsAppSyncItem']

export interface ContactFilters {
  search: string
  origen: ContactOrigin | ''
  tag: string
  /** Inicial del nombre (una letra, "Ñ" o "#"); vacío = todas. */
  initial: string
  hasLead: '' | 'yes' | 'no'
  consent: '' | 'yes' | 'no'
  removedInApp: boolean
}
