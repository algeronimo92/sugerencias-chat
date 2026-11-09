import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Select } from '../../../shared/ui/Input'
import { actionTypeOptions } from './actionTypeOptions'

describe('actionTypeOptions', () => {
  it('el Select ve las opciones agrupadas: envueltas en un componente quedaba vacío', () => {
    render(<Select value="change_service" aria-label="Acción" onChange={() => {}}>{actionTypeOptions()}</Select>)
    expect(screen.getByRole('combobox', { name: 'Acción' })).toHaveTextContent('Cambiar/quitar servicio de interés')
  })
})
