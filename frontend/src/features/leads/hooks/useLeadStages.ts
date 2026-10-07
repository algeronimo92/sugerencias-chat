import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchAdminLeadStages, createLeadStage, deleteLeadStage, fetchLeadStages, reorderLeadStages, updateLeadStage } from '../api'
import { buildStageCatalog, DEFAULT_LEAD_STAGES, type LeadStageCatalog } from '../domain/leadStageMeta'
import { kanbanKeys, stageKeys } from '../keys'


/** Etapas del negocio (activas e inactivas) en el orden del embudo. Cambian
 *  poco y el backend avisa por WebSocket (`lead_stages_updated`) cuando el
 *  admin las edita, así que se sirven de caché varios minutos. */
export function useLeadStages() {
  return useQuery({
    queryKey: stageKeys.list,
    queryFn: fetchLeadStages,
    staleTime: 5 * 60_000,
  })
}

/**
 * Lo que usan las pantallas: etapas ordenadas, las activas y la búsqueda por
 * clave. Mientras cargan (o si la consulta falla) se usan las etapas con las
 * que nace todo negocio, para no dejar el embudo en blanco; una clave que el
 * negocio no tiene se rotula igual, en gris.
 */
export function useLeadStageCatalog(): LeadStageCatalog & { isLoading: boolean } {
  const { data, isLoading } = useLeadStages()
  const catalog = useMemo(() => buildStageCatalog(data ?? DEFAULT_LEAD_STAGES), [data])
  return { ...catalog, isLoading }
}

export function useAdminLeadStages() {
  return useQuery({
    queryKey: stageKeys.admin,
    queryFn: fetchAdminLeadStages,
  })
}

function useInvalidateStages() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: stageKeys.all })
    // El kanban ordena y rotula con las etapas; el dashboard se entera por el
    // aviso lead_stages_updated, que tambi�n llega a quien hizo el cambio.
    void queryClient.invalidateQueries({ queryKey: kanbanKeys.all })
  }
}

export type { LeadStageInput } from '../types'

export function useCreateLeadStage() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: createLeadStage,
    onSuccess: invalidate,
  })
}

export function useUpdateLeadStage() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: updateLeadStage,
    onSuccess: invalidate,
  })
}

export function useReorderLeadStages() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: reorderLeadStages,
    onSuccess: invalidate,
  })
}

export function useDeleteLeadStage() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: deleteLeadStage,
    onSuccess: invalidate,
  })
}
