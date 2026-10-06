import { useQuery } from '@tanstack/react-query'
import { searchLeads } from '../api'



export function useLeadSearch(term: string) {
  const search = term.trim()
  return useQuery({
    queryKey: ['lead-search', search],
    queryFn: ({ signal }) => searchLeads(search, signal),
    enabled: search.length > 0,
    staleTime: 30_000,
  })
}
