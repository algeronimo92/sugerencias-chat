import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SuggestionsEmptyState } from './ChatWorkspaceParts'

const usage = vi.hoisted(() => ({ data: undefined as unknown }))

vi.mock('../../ai/public/useAiUsage', () => ({ useAiUsage: () => usage }))

describe('SuggestionsEmptyState', () => {
  beforeEach(() => {
    usage.data = undefined
  })

  it('invita a elegir un lead cuando el negocio tiene IA', () => {
    usage.data = { enabled: true, monthly_quota: null, used_this_month: 0, remaining: null, unavailable_reason: null }
    render(<SuggestionsEmptyState />)

    expect(screen.getByText(/Selecciona un lead para ver las sugerencias/)).toBeInTheDocument()
  })

  it('sin IA en el paquete dice por qué y a cuál subir, en vez de invitar a usarla', () => {
    usage.data = {
      enabled: false, monthly_quota: 0, used_this_month: 0, remaining: 0,
      unavailable_reason: 'Tu paquete Básico no incluye las sugerencias y el análisis de leads con IA. Viene desde el paquete Esencial: pide el cambio al equipo de CliniVentas.',
    }
    render(<SuggestionsEmptyState />)

    expect(screen.getByRole('status')).toHaveTextContent('Tu paquete Básico no incluye las sugerencias')
    expect(screen.queryByText(/Selecciona un lead/)).not.toBeInTheDocument()
  })
})
