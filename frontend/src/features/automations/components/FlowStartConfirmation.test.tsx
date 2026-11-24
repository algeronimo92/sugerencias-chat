/**
 * La confirmación de "Iniciar flujo": nada se lanza hasta tocar "Iniciar", y
 * cancelar (o Escape) cierra la pregunta sin pedir nada al backend.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowStartConfirmation } from './FlowStartConfirmation'

const mutate = vi.fn()
const CHAT_ID = '7b08f4d9-855f-4718-b95f-9c021da52f77'
let isPending = false

vi.mock('../queries', () => ({
  useStartManualFlow: () => ({ mutate, isPending }),
}))

const FLOW = { id: 9, name: 'Bienvenida guiada' }

describe('FlowStartConfirmation', () => {
  beforeEach(() => {
    mutate.mockReset()
    isPending = false
  })

  it('pregunta por el flujo elegido y lo inicia solo al confirmar', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<FlowStartConfirmation chatId={CHAT_ID} flow={FLOW} onClose={onClose} />)

    expect(screen.getByRole('group', { name: 'Confirmar la automatización Bienvenida guiada' })).toHaveTextContent('¿Iniciar «Bienvenida guiada»?')
    expect(mutate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Iniciar' }))

    expect(mutate).toHaveBeenCalledWith(
      { ruleId: 9, chatId: CHAT_ID },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function), onSettled: onClose }),
    )
  })

  it('cancelar cierra la pregunta sin iniciar nada', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<FlowStartConfirmation chatId={CHAT_ID} flow={FLOW} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('Escape también cancela, porque el foco queda en "Iniciar"', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<FlowStartConfirmation chatId={CHAT_ID} flow={FLOW} onClose={onClose} />)

    expect(screen.getByRole('button', { name: 'Iniciar' })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('mientras se inicia no se puede volver a tocar', () => {
    isPending = true
    render(<FlowStartConfirmation chatId={CHAT_ID} flow={FLOW} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })
})
