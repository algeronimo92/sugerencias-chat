interface ServiceOption { id: number; name: string }

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Los servicios del catálogo a los que corresponde la sugerencia de una
 * plantilla. El catálogo nombra "Tratamiento - Zona" y una ficha sirve para
 * todas las zonas: «Hollywood Peel» → Rostro, Rostro + Cuello, Axilas…;
 * «Botox» → 1, 2 y 3 Zonas. Antes se elegía UNA, la de nombre más corto, y
 * quedaban «Hollywood Peel - Axilas» o «HIFU - Brazos»: 15 de 16 fichas
 * importadas terminaron sin servicio o con el equivocado (2026-11-09).
 *
 * La sugerencia puede nombrar varios tratamientos separados por «·» o «,».
 * Se compara por palabra completa: «Peel» no elige «Hollywood Peel».
 */
export function matchServices(hint: string | null | undefined, services: readonly ServiceOption[]): number[] {
  if (!hint) return []
  const wanted = hint.split(/[·,]/).map(fold).filter(Boolean)
  const ids = new Set<number>()
  for (const term of wanted) {
    for (const service of services) {
      const name = fold(service.name)
      if (name === term || name.startsWith(`${term} `) || name.startsWith(`${term}-`)) ids.add(service.id)
    }
  }
  return [...ids]
}
