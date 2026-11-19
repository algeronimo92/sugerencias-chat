import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'
import { Counter } from './Badge'
import { Button } from './Button'
import { Field } from './Field'
import { Input } from './Input'

describe('Field', () => {
  it('conecta la etiqueta y la ayuda con el control', () => {
    render(
      <Field label="Teléfono" hint="Con código de país">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Teléfono')
    expect(input).toHaveAccessibleDescription('Con código de país')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('con error marca el campo inválido, lo anuncia y reemplaza la ayuda', () => {
    render(
      <Field label="Correo" hint="Opcional" error="Falta la arroba">
        <Input id="correo" aria-describedby="otro" />
      </Field>,
    )

    const input = screen.getByLabelText('Correo')
    expect(input).toHaveAttribute('id', 'correo')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe('otro correo-error')
    expect(screen.getByRole('alert')).toHaveTextContent('Falta la arroba')
    expect(screen.queryByText('Opcional')).not.toBeInTheDocument()
  })
})

describe('Counter', () => {
  it('muestra 99+ desde 100 y deja el total en el nombre accesible', () => {
    render(<Counter value={128} />)

    expect(screen.getByText('99+')).toHaveAttribute('aria-label', '128')
  })

  it('muestra el número tal cual por debajo de 100', () => {
    render(<Counter value={7} />)

    expect(screen.getByText('7')).not.toHaveAttribute('aria-label')
  })
})

describe('Button', () => {
  it('cargando queda deshabilitado y anunciado como ocupado', () => {
    render(<Button loading>Guardar</Button>)

    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })
})

describe('Avatar', () => {
  it('sin foto muestra las iniciales del nombre y de la última palabra', () => {
    const { container } = render(<Avatar name="Josefina  de la Paredes" />)

    expect(container).toHaveTextContent('JP')
  })

  it('el mismo lead conserva el color aunque cambie de nombre', () => {
    const first = render(<Avatar name="Ana" seed="lead-42" />).container.firstElementChild?.className
    const renamed = render(<Avatar name="Ana Torres" seed="lead-42" />).container.firstElementChild?.className

    expect(renamed).toBe(first)
  })
})
