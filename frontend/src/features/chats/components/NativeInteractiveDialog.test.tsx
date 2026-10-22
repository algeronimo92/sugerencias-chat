import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TemplateCapabilities } from '../../templates/types'
import { NativeInteractiveDialog } from './NativeInteractiveDialog'

const mutate = vi.fn()
vi.mock('../hooks/useOutboundMessage', () => ({
  useOutboundMessage: () => ({ mutate, isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const CAPABILITIES = {
  official_sending_supported: true,
  interactive_limits: {},
  catalog_enabled: true,
  flows_enabled: false,
  call_permission_enabled: true,
  catalog_id: 'cat-1',
  published_flows: [],
} as unknown as TemplateCapabilities

function renderDialog() {
  render(
    <NativeInteractiveDialog chatId="lead-1" capabilities={CAPABILITIES} replyTo={null} onSent={vi.fn()} onClose={vi.fn()} />,
  )
}

beforeEach(() => mutate.mockReset())

describe('NativeInteractiveDialog', () => {
  it('solo ofrece los tipos que la cuenta tiene habilitados', () => {
    renderDialog()

    expect(screen.getByRole('radio', { name: 'Producto' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Permiso de llamada' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Formulario (Flow)' })).not.toBeInTheDocument()
  })

  it('no manda nada y muestra los errores si falta un dato obligatorio', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Indica el SKU del producto.')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('manda el objeto interactive de Meta con el catálogo de la cuenta', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(screen.getByPlaceholderText('product_retailer_id'), 'SKU-9')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(mutate).toHaveBeenCalledWith(
      {
        kind: 'interactive',
        interactive: { type: 'product', action: { catalog_id: 'cat-1', product_retailer_id: 'SKU-9' } },
        replyTo: null,
      },
      expect.any(Object),
    )
  })
})
