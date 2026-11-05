import type { StarterPackResult } from './types'

/** Resumen legible de lo que agregó el paquete inicial. */
export function describeStarterPackResult(result: StarterPackResult): string {
  const added = result.tags + result.categories + result.templates + result.automations
  const parts = [
    `${result.tags} etiquetas`,
    `${result.templates} plantillas`,
    `${result.automations} automatizaciones`,
  ]
  const summary = added === 0 ? 'El negocio ya tenía todo el paquete.' : `Se agregaron ${parts.join(', ')}.`
  return result.needs_admin
    ? `${summary} Plantillas y automatizaciones quedan pendientes hasta que el negocio tenga un admin activo.`
    : summary
}
