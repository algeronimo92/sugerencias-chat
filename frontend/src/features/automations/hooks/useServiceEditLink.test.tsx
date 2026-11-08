import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { editFieldHref } from '../../../shared/navigation/editFieldLink'
import type { AutomationRule } from '../types'
import { useServiceEditLink } from './useServiceEditLink'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const rules = [{ id: 31, name: 'Seguimiento botox' }] as AutomationRule[]

function Probe({ open, isLoading = false }: { open: (rule: AutomationRule, highlight: unknown) => void; isLoading?: boolean }) {
  useServiceEditLink(rules, isLoading, open)
  return <p data-testid="search">{useLocation().search}</p>
}

function renderAt(url: string, open = vi.fn(), isLoading = false) {
  render(<MemoryRouter initialEntries={[url]}><Probe open={open} isLoading={isLoading} /></MemoryRouter>)
  return open
}

describe('useServiceEditLink', () => {
  it('abre la regla del enlace con el servicio a resaltar y quita los parámetros', () => {
    const open = renderAt(`${editFieldHref('/automations', 'servicio', 'Cámbialo', { record: 31, value: 'Botox' })}&tab=1`)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(rules[0], { service: 'Botox', reason: 'Cámbialo' })
    // Cerrar o recargar no la vuelve a abrir; el resto de la URL queda.
    expect(screen.getByTestId('search')).toHaveTextContent(/^\?tab=1$/)
  })

  it('espera a que carguen las reglas', () => {
    const open = renderAt(editFieldHref('/automations', 'servicio', undefined, { record: 31, value: 'Botox' }), vi.fn(), true)
    expect(open).not.toHaveBeenCalled()
  })

  it('avisa si la regla ya no existe, y no abre nada sin un enlace completo', () => {
    const open = renderAt(editFieldHref('/automations', 'servicio', undefined, { record: 99, value: 'Botox' }))
    expect(open).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('ya no existe'))

    expect(renderAt('/automations?editar=servicio')).not.toHaveBeenCalled()
  })
})
