import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StageColorPicker } from './StageColorPicker'

afterEach(() => vi.useRealTimers())

describe('StageColorPicker', () => {
  it('actualiza la muestra local sin renderizar el panel por cada movimiento', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<StageColorPicker value="#0ea5e9" onChange={onChange} label="Color de Nuevo" />)
    const picker = screen.getByLabelText('Color de Nuevo')

    fireEvent.change(picker, { target: { value: '#111111' } })
    fireEvent.change(picker, { target: { value: '#222222' } })
    fireEvent.change(picker, { target: { value: '#abcdef' } })

    expect(picker).toHaveValue('#abcdef')
    expect(screen.getByLabelText('Color de Nuevo hexadecimal')).toHaveValue('#ABCDEF')
    expect(onChange).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(120))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#abcdef')
  })

  it('confirma inmediatamente el último color al salir del selector', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<StageColorPicker value="#0ea5e9" onChange={onChange} label="Color de Nuevo" />)
    const picker = screen.getByLabelText('Color de Nuevo')

    fireEvent.change(picker, { target: { value: '#123456' } })
    fireEvent.blur(picker)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('#123456')
    act(() => vi.runAllTimers())
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
