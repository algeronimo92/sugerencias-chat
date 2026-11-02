/** Forma comparable de un nombre: sin tildes, sin mayúsculas y con los
 * espacios colapsados como los deja el backend al crear un servicio. */
export function normalizeServiceName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

/** Servicios cuyo nombre contiene lo escrito; sin texto, todos. */
export function filterServices<T extends { name: string }>(services: readonly T[], query: string): T[] {
  const needle = normalizeServiceName(query)
  if (!needle) return [...services]
  return services.filter(service => normalizeServiceName(service.name).includes(needle))
}

/** Lo escrito ya es un servicio del catálogo: entonces no se ofrece crearlo. */
export function hasExactService(services: readonly { name: string }[], query: string): boolean {
  const needle = normalizeServiceName(query)
  return services.some(service => normalizeServiceName(service.name) === needle)
}
