import { useQuery } from '@tanstack/react-query'
import { requestLeadSearch } from '../api'



export function useLeadSearch(term: string) {
  const search = term.trim()
  return useQuery({
    queryKey: ['lead-search', search],
    queryFn: requestLeadSearch(search),
    enabled: search.length > 0,
    staleTime: 30_000,
  })
}
