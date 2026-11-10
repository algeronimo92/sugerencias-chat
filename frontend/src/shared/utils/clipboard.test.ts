import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

describe('copyText', () => {
  afterEach(() => vi.restoreAllMocks())

  it('usa la API del portapapeles cuando está permitida', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    await expect(copyText('hola')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hola')
  })

  it('si el navegador la niega, copia seleccionando el texto', async () => {
    setClipboard(vi.fn().mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError')))
    let selected = ''
    const execCommand = vi.fn(() => {
      selected = document.querySelector('textarea')?.value ?? ''
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await expect(copyText('https://x.test/#a')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(selected).toBe('https://x.test/#a')
    // No deja el campo auxiliar en la página.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('avisa si ninguno de los dos caminos pudo copiar', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denegado')))
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
    await expect(copyText('x')).resolves.toBe(false)
  })
})
