import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteLeadSale, fetchLeadSales, recordLeadSale } from '../api'
import { kanbanKeys, leadKeys } from '../keys'
import type { LeadSaleInput } from '../types'

export function useLeadSales(chatId: string | null) {
  return useQuery({
    queryKey: leadKeys.sales(chatId),
    queryFn: () => fetchLeadSales(chatId as string),
    enabled: chatId != null,
    staleTime: 30_000,
  })
}

/** Registrar o borrar una compra también deja rastro en la actividad del
 *  lead, y el kanban muestra la etapa: se refresca todo lo que lo mira. */
function useInvalidateSales(chatId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: leadKeys.sales(chatId) })
    queryClient.invalidateQueries({ queryKey: leadKeys.activity(chatId) })
    queryClient.invalidateQueries({ queryKey: leadKeys.detail(chatId) })
    queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
  }
}

export function useRecordLeadSale(chatId: string) {
  const invalidate = useInvalidateSales(chatId)
  return useMutation({
    mutationFn: (sale: LeadSaleInput) => recordLeadSale({ chatId, ...sale }),
    onSuccess: invalidate,
  })
}

export function useDeleteLeadSale(chatId: string) {
  const invalidate = useInvalidateSales(chatId)
  return useMutation({
    mutationFn: (saleId: number) => deleteLeadSale({ chatId, saleId }),
    onSuccess: invalidate,
  })
}
