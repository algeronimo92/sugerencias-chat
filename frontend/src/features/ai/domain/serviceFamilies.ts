export interface ServiceLike { id: number; name: string; is_active?: boolean }

export interface ServiceFamily<T extends ServiceLike = ServiceLike> {
  /** El tratamiento: «Botox» para «Botox - 1 Zona», «Botox - 2 Zonas»… */
  name: string
  services: T[]
}

/**
 * El catálogo (61 de 62 servicios vienen del ERP) nombra «Tratamiento - Zona»
 * o «Tratamiento - Tamaño». Para la IA lo que importa es el tratamiento: una
 * ficha sirve para todas sus zonas. Sin « - » el servicio es su propia familia.
 */
export function serviceFamily(name: string): string {
  const [family] = name.split(' - ')
  return family.trim() || name.trim()
}

/** Agrupa por tratamiento conservando el orden en que vienen los servicios. */
export function groupByFamily<T extends ServiceLike>(services: readonly T[]): ServiceFamily<T>[] {
  const groups = new Map<string, ServiceFamily<T>>()
  for (const service of services) {
    const name = serviceFamily(service.name)
    const group = groups.get(name)
    if (group) group.services.push(service)
    else groups.set(name, { name, services: [service] })
  }
  return [...groups.values()]
}

/** Los ids de todos los servicios del mismo tratamiento que `serviceId`
 *  (él incluido). Al crear una ficha desde «Botox - 1 Zona» en Catálogos se
 *  marcan las tres zonas, no solo la pulsada. */
export function familyMembers(services: readonly ServiceLike[], serviceId: number): number[] {
  const origin = services.find(service => service.id === serviceId)
  if (!origin) return [serviceId]
  const family = serviceFamily(origin.name)
  return services.filter(service => service.is_active !== false && serviceFamily(service.name) === family).map(service => service.id)
}

export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
