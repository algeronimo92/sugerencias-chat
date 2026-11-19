import type { ContactFilters } from '../types'

export const EMPTY_FILTERS: ContactFilters = { search: '', origen: '', tag: '', hasLead: '', consent: '', removedInApp: false }

export function hasActiveFilters(filters: ContactFilters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof ContactFilters)[]).some(key => filters[key] !== EMPTY_FILTERS[key])
}
