import type { ContactFilters } from '../types'

export const EMPTY_FILTERS: ContactFilters = { search: '', origen: '', tag: '', initial: '', hasLead: '', consent: '', removedInApp: false }

export function hasActiveFilters(filters: ContactFilters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof ContactFilters)[]).some(key => filters[key] !== EMPTY_FILTERS[key])
}

/** Las iniciales del filtro A-Z, en el orden del abecedario español: la Ñ
 *  va después de la N y "#" agrupa a quien no empieza con letra (o solo tiene
 *  número). El servidor pliega las tildes: "Ángela" está en la A. */
export const INITIALS: readonly string[] = [...'ABCDEFGHIJKLMN', 'Ñ', ...'OPQRSTUVWXYZ', '#']
