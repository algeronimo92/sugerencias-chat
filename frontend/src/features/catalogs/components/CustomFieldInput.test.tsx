import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CustomFieldDefinition } from '../hooks/useCustomFields'
import { CustomFieldInput } from './CustomFieldInput'

const field = (overrides: Partial<CustomFieldDefinition> = {}) => ({
  id: 1, entity_type: 'appointment', key: 'adelanto', label: 'Adelanto', field_type: 'number',
  required: true, options: [], position: 0, is_active: true, ...overrides,
}) as CustomFieldDefinition

describe('CustomFieldInput', () => {
  it('muestra un monto con el símbolo de la moneda, sin negativos y con céntimos', () => {
    render(<CustomFieldInput field={field()} value="14.5" onChange={() => {}} currency="PEN" />)

    const input = screen.getByRole('spinbutton')
    expect(screen.getByText('S/')).toBeInTheDocument()
    expect(input).toHaveAttribute('min', '0')
    // Sin step el navegador solo acepta enteros y rechaza 14.5 al guardar.
    expect(input).toHaveAttribute('step', '0.01')
    expect(input).toHaveValue(14.5)
  })

  it('sin moneda configurada sigue siendo un monto, solo que sin símbolo', () => {
    render(<CustomFieldInput field={field()} value="" onChange={() => {}} currency={null} />)
    expect(screen.getByRole('spinbutton')).toHaveAttribute('min', '0')
    expect(screen.queryByText('S/')).toBeNull()
  })

  it('un número cualquiera acepta decimales y no lleva mínimo', () => {
    render(<CustomFieldInput field={field({ key: 'peso', label: 'Peso' })} value="" onChange={() => {}} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveAttribute('step', 'any')
    expect(input).not.toHaveAttribute('min')
  })
})
