import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../../shared/queryClient'
import {
  changeContactTags, confirmImport, createContact, createCsvImport, deleteContacts, discardImport, fetchContacts,
  fetchContactTags, fetchImport, fetchImportRows, fetchImports, fetchWhatsAppSync, previewCsv, promoteContact,
  promoteContacts, retryWhatsAppSync, setWhatsAppAutoImport, updateContact,
} from '../api'
import { contactKeys } from '../keys'
import type { ContactFilters, ImportRowStatus } from '../types'

function invalidateContacts() {
  void queryClient.invalidateQueries({ queryKey: contactKeys.all })
}

function invalidateImports() {
  void queryClient.invalidateQueries({ queryKey: contactKeys.imports })
}

export function useContacts(filters: ContactFilters, page: number) {
  return useQuery({
    queryKey: contactKeys.list(filters, page),
    queryFn: () => fetchContacts(filters, page),
    placeholderData: keepPreviousData,
  })
}

export function useContactTags() {
  return useQuery({ queryKey: contactKeys.tags, queryFn: fetchContactTags })
}

export function useCreateContact() {
  return useMutation({ mutationFn: createContact, onSuccess: invalidateContacts })
}

export function useUpdateContact() {
  return useMutation({ mutationFn: updateContact, onSuccess: invalidateContacts })
}

export function useDeleteContacts() {
  return useMutation({ mutationFn: deleteContacts, onSuccess: invalidateContacts })
}

export function useChangeContactTags() {
  return useMutation({ mutationFn: changeContactTags, onSuccess: invalidateContacts })
}

export function usePromoteContact() {
  return useMutation({ mutationFn: promoteContact, onSuccess: invalidateContacts })
}

export function usePromoteContacts() {
  return useMutation({ mutationFn: promoteContacts, onSuccess: invalidateContacts })
}

/* ---------------------------------------------------------- importaciones */

export function useImports(enabled: boolean) {
  return useQuery({ queryKey: contactKeys.importList, queryFn: fetchImports, enabled })
}

export function useImportSummary(batchId: string | null) {
  return useQuery({
    queryKey: contactKeys.import(batchId ?? ''),
    queryFn: () => fetchImport(batchId ?? ''),
    enabled: batchId !== null,
  })
}

export function useImportRows(batchId: string, status: ImportRowStatus, search: string, page: number, enabled = true) {
  return useQuery({
    queryKey: contactKeys.importRows(batchId, status, search, page),
    queryFn: () => fetchImportRows(batchId, status, search, page),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function usePreviewCsv() {
  return useMutation({ mutationFn: previewCsv })
}

export function useCreateCsvImport() {
  return useMutation({ mutationFn: createCsvImport, onSuccess: invalidateImports })
}

export function useConfirmImport() {
  return useMutation({
    mutationFn: confirmImport,
    onSuccess: () => { invalidateImports(); invalidateContacts() },
  })
}

export function useDiscardImport() {
  return useMutation({ mutationFn: discardImport, onSuccess: invalidateImports })
}

/* ---------------------------------------------- sincronización del celular */

export function useWhatsAppSync(enabled: boolean) {
  return useQuery({ queryKey: contactKeys.whatsappSync, queryFn: fetchWhatsAppSync, enabled })
}

export function useSetWhatsAppAutoImport() {
  return useMutation({
    mutationFn: setWhatsAppAutoImport,
    onSuccess: data => queryClient.setQueryData(contactKeys.whatsappSync, data),
  })
}

export function useRetryWhatsAppSync() {
  return useMutation({ mutationFn: retryWhatsAppSync, onSuccess: invalidateImports })
}
