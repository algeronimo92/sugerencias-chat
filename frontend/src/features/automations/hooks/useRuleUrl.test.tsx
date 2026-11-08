import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { editFieldHref } from '../../../shared/navigation/editFieldLink'
import type { AutomationRule } from '../types'
import { useRuleUrl, type RuleUrl } from './useRuleUrl'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

const rules = [{ id: 31, name: 'Seguimiento botox' }] as AutomationRule[]

function Probe({ seen, isLoading }: { seen: RuleUrl[]; isLoading: boolean }) {
  seen.push(useRuleUrl(rules, isLoading))
  return <p data-testid="search">{useLocation().search}</p>
}

function renderAt(url: string, isLoading = false) {
  const seen: RuleUrl[] = []
  render(<MemoryRouter initialEntries={[url]}><Probe seen={seen} isLoading={isLoading} /></MemoryRouter>)
  return seen
}

const search = () => new URLSearchParams(screen.getByTestId('search').textContent ?? '')

describe('useRuleUrl', () => {
  it('abre la automatización de la URL, y abrir o cerrar solo cambia la URL', () => {
    const seen = renderAt('/automations?automatizacion=31&tab=1')
    expect(seen.at(-1)).toMatchObject({ rule: rules[0], highlight: null, key: '31::' })

    act(() => seen.at(-1)!.close())
    expect(search().toString()).toBe('tab=1')
    expect(seen.at(-1)?.rule).toBeNull()

    act(() => seen.at(-1)!.open(31))
    expect(search().get('automatizacion')).toBe('31')
  })

  it('el enlace de Catálogos queda como ?automatizacion=<id> y conserva el realce al recargar', () => {
    const seen = renderAt(editFieldHref('/automations', 'servicio', 'Cámbialo', { record: 31, value: 'Botox' }))
    expect(seen.at(-1)).toMatchObject({ rule: rules[0], highlight: { service: 'Botox', reason: 'Cámbialo', part: 'action' } })
    expect(search().get('automatizacion')).toBe('31')
    expect(search().get('registro')).toBeNull()
    expect(search().get('editar')).toBe('servicio')
    // Normalizar la URL no cambia qué está abierto: la pantalla no lo reabre.
    expect(new Set(seen.filter(item => item.key).map(item => item.key))).toEqual(new Set(['31:action:Botox']))
  })

  it('la condición que filtra por el nombre llega con su propio campo', () => {
    const seen = renderAt(editFieldHref('/automations', 'servicio_filtro', undefined, { record: 31, value: 'Botox' }))
    expect(seen.at(-1)?.highlight).toEqual({ service: 'Botox', reason: null, part: 'condition' })
  })

  it('espera a que carguen las reglas sin tocar la URL', () => {
    const seen = renderAt('/automations?automatizacion=31', true)
    expect(seen.every(item => item.rule === null)).toBe(true)
    expect(search().get('automatizacion')).toBe('31')
  })

  it('avisa si la automatización ya no existe y la saca de la URL', () => {
    const seen = renderAt('/automations?automatizacion=99')
    expect(seen.every(item => item.rule === null)).toBe(true)
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('ya no existe'))
    expect(search().get('automatizacion')).toBeNull()
  })
})
