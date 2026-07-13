import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from '../api/client'
import type { Chat, LeadStage } from '../types'

const KANBAN_PAGE_SIZE = 40

interface KanbanPage {
  items: Chat[]
  has_more: boolean
}

async function fetchKanbanCounts(search: string): Promise<Record<LeadStage, number>> {
  const { data } = await client.get<Record<LeadStage, number>>('/api/chats/kanban/counts', {
    params: search ? { search } : undefined,
  })
  return data
}

async function fetchKanbanStage(stage: LeadStage, search: string, offset: number): Promise<KanbanPage> {
  const { data } = await client.get<KanbanPage>(`/api/chats/kanban/${stage}`, {
    params: { offset, limit: KANBAN_PAGE_SIZE, ...(search ? { search } : {}) },
  })
  return data
}

export function useKanbanCounts(search: string) {
  return useQuery({
    queryKey: ['kanban', 'counts', search],
    queryFn: () => fetchKanbanCounts(search),
    staleTime: 20_000,
  })
}

export function useKanbanStage(stage: LeadStage, search: string) {
  return useInfiniteQuery({
    queryKey: ['kanban', 'stage', stage, search],
    queryFn: ({ pageParam }) => fetchKanbanStage(stage, search, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.has_more ? pages.reduce((total, page) => total + page.items.length, 0) : undefined,
    staleTime: 20_000,
    retry: false,
  })
}

interface MoveLeadStageInput {
  chatId: string
  stage: LeadStage
}

async function moveLeadStage({ chatId, stage }: MoveLeadStageInput): Promise<Chat> {
  const { data } = await client.patch<Chat>(`/api/chats/${encodeURIComponent(chatId)}/stage`, { stage })
  return data
}

export function useMoveLeadStage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: moveLeadStage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban'] })
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activity'] })
    },
  })
}
