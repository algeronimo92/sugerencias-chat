import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import { buildStageCatalog, DEFAULT_LEAD_STAGES, type LeadStageCatalog } from '../domain/leadStageMeta'
import type { LeadStage, LeadStageAdminDefinition, LeadStageDefinition, LeadStageKind } from '../types'

const STAGES_KEY = ['lead-stages'] as const

/** Etapas del negocio (activas e inactivas) en el orden del embudo. Cambian
 *  poco y el backend avisa por WebSocket (`lead_stages_updated`) cuando el
 *  admin las edita, así que se sirven de caché varios minutos. */
export function useLeadStages() {
  return useQuery({
    queryKey: [...STAGES_KEY, 'list'],
    queryFn: async () => (await client.get<LeadStageDefinition[]>('/api/lead-stages')).data,
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
    queryKey: [...STAGES_KEY, 'admin'],
    queryFn: async () => (await client.get<LeadStageAdminDefinition[]>('/api/lead-stages/all')).data,
  })
}

function useInvalidateStages() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: STAGES_KEY })
    // El kanban y el dashboard ordenan y rotulan con las etapas.
    void queryClient.invalidateQueries({ queryKey: ['kanban'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

export interface LeadStageInput {
  name: string
  color: string
  kind: LeadStageKind
  description?: string | null
}

export function useCreateLeadStage() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: async (values: LeadStageInput) =>
      (await client.post<LeadStageDefinition>('/api/lead-stages', values)).data,
    onSuccess: invalidate,
  })
}

export function useUpdateLeadStage() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: async ({ key, ...values }: Partial<LeadStageInput> & { key: LeadStage; is_active?: boolean }) =>
      (await client.patch<LeadStageDefinition>(`/api/lead-stages/${encodeURIComponent(key)}`, values)).data,
    onSuccess: invalidate,
  })
}

export function useReorderLeadStages() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: async (keys: LeadStage[]) =>
      (await client.put<LeadStageAdminDefinition[]>('/api/lead-stages/order', { keys })).data,
    onSuccess: invalidate,
  })
}

export function useDeleteLeadStage() {
  const invalidate = useInvalidateStages()
  return useMutation({
    mutationFn: async (key: LeadStage) => {
      await client.delete(`/api/lead-stages/${encodeURIComponent(key)}`)
    },
    onSuccess: invalidate,
  })
}
