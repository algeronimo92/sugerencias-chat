import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceCombobox } from './ServiceCombobox'

type CreateCallbacks = { onSuccess: (service: { id: number; name: string }) => void; onError: (error: unknown) => void }

const mocks = vi.hoisted(() => ({
  services: [] as { id: number; name: string }[],
  createMutate: vi.fn<(name: string, callbacks: CreateCallbacks) => void>(),
}))

vi.mock('../../catalogs/public/useLeadServices', () => ({
  useLeadServices: () => ({ data: mocks.services, isLoading: false }),
  useCreateLeadService: () => ({ isPending: false, mutate: mocks.createMutate }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="svc">Servicio</label>
      <ServiceCombobox id="svc" value={value} onChange={name => { setValue(name); onChange?.(name) }} />
      <output data-testid="value">{value}</output>
    </>
  )
}

const optionNames = () => screen.getAllByRole('option').map(option => option.textContent)

describe('ServiceCombobox', () => {
  afterEach(() => {
    mocks.services = []
    mocks.createMutate.mockReset()
  })

  it('lista el catálogo y filtra sin distinguir mayúsculas ni tildes', async () => {
    mocks.services = [{ id: 1, name: 'Depilación Láser' }, { id: 2, name: 'Limpieza facial' }, { id: 3, name: 'Consulta' }]
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByRole('combobox', { name: 'Servicio' })
    await user.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(optionNames()).toEqual(['Depilación Láser', 'Limpieza facial', 'Consulta'])

    await user.type(input, 'DEPILACION')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Depilación Láser')
    expect(screen.queryByRole('option', { name: 'Limpieza facial' })).not.toBeInTheDocument()
  })

  it('se maneja con flechas, Enter y Escape', async () => {
    mocks.services = [{ id: 1, name: 'Consulta' }, { id: 2, name: 'Control' }]
    const user = userEvent.setup()
    render(<Harness initial="Consulta" />)

    const input = screen.getByRole('combobox', { name: 'Servicio' })
    input.focus()
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Control' }).id)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('Control')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('Control')

    // Escape descarta lo escrito y deja el servicio que ya estaba elegido.
    await user.type(input, 'xyz')
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('Control')
  })

  it('crea el servicio si lo escrito no existe y lo deja elegido', async () => {
    mocks.services = [{ id: 1, name: 'Consulta' }]
    mocks.createMutate.mockImplementation((name, { onSuccess }) => onSuccess({ id: 9, name }))
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)

    await user.type(screen.getByRole('combobox', { name: 'Servicio' }), '  Peeling   químico ')
    await user.click(screen.getByRole('option', { name: 'Crear servicio «Peeling químico»' }))

    expect(mocks.createMutate).toHaveBeenCalledWith('Peeling químico', expect.any(Object))
    expect(onChange).toHaveBeenCalledWith('Peeling químico')
    expect(screen.getByTestId('value')).toHaveTextContent('Peeling químico')
  })

  it('no ofrece crear un servicio que ya existe escrito con otras tildes', async () => {
    mocks.services = [{ id: 1, name: 'Depilación' }]
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('combobox', { name: 'Servicio' }), 'depilacion')
    expect(optionNames()).toEqual(['Depilación'])
  })

  it('muestra el error del backend si no se pudo crear', async () => {
    mocks.createMutate.mockImplementation((_name, { onError }) => onError(new Error('Ya existe un servicio con ese nombre')))
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByRole('combobox', { name: 'Servicio' })
    await user.type(input, 'Botox{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe un servicio con ese nombre')
    expect(screen.getByTestId('value')).toBeEmptyDOMElement()
  })
})
