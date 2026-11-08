import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { editFieldHref } from '../../../shared/navigation/editFieldLink'
import type { AutomationRule } from '../types'
import { useServiceEditLink, type ServiceEditLink } from './useServiceEditLink'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const rules = [{ id: 31, name: 'Seguimiento botox' }] as AutomationRule[]

function Probe({ seen, isLoading }: { seen: Array<ServiceEditLink | null>; isLoading: boolean }) {
  seen.push(useServiceEditLink(rules, isLoading))
  return <p data-testid="search">{useLocation().search}</p>
}

function renderAt(url: string, isLoading = false) {
  const seen: Array<ServiceEditLink | null> = []
  render(<MemoryRouter initialEntries={[url]}><Probe seen={seen} isLoading={isLoading} /></MemoryRouter>)
  return seen
}

describe('useServiceEditLink', () => {
  it('dice qué regla abrir y qué servicio resaltar, y después quita los parámetros', () => {
    const seen = renderAt(`${editFieldHref('/automations', 'servicio', 'Cámbialo', { record: 31, value: 'Botox' })}&tab=1`)
    expect(seen[0]).toEqual({ key: '31:Botox', rule: rules[0], highlight: { service: 'Botox', reason: 'Cámbialo' } })
    // Cerrar o recargar no la vuelve a abrir; el resto de la URL queda.
    expect(seen.at(-1)).toBeNull()
    expect(screen.getByTestId('search')).toHaveTextContent(/^\?tab=1$/)
  })

  it('espera a que carguen las reglas sin tocar la URL', () => {
    const seen = renderAt(editFieldHref('/automations', 'servicio', undefined, { record: 31, value: 'Botox' }), true)
    expect(seen.every(link => link === null)).toBe(true)
    expect(screen.getByTestId('search')).toHaveTextContent('registro=31')
  })

  it('avisa si la regla ya no existe, y no abre nada sin un enlace completo', () => {
    expect(renderAt(editFieldHref('/automations', 'servicio', undefined, { record: 99, value: 'Botox' })).every(link => link === null)).toBe(true)
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('ya no existe'))
    expect(renderAt('/automations?editar=servicio').every(link => link === null)).toBe(true)
  })
})
