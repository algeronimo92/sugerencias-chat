import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDismissiblePopover } from './useDismissiblePopover'

function Fixture({ onDismiss, withPortal = false }: { onDismiss: () => void; withPortal?: boolean }) {
  const portalRef = useRef<HTMLDivElement>(null)
  const rootRef = useDismissiblePopover<HTMLDivElement>(true, onDismiss, withPortal ? portalRef : undefined)
  return <div>
    <div ref={rootRef} data-testid="root"><button type="button">Dentro</button></div>
    {withPortal && <div ref={portalRef} data-testid="portal"><button type="button">Portal</button></div>}
    <button type="button">Fuera</button>
  </div>
}

describe('useDismissiblePopover', () => {
  it('cierra al pulsar fuera y no al pulsar dentro', () => {
    const onDismiss = vi.fn()
    render(<Fixture onDismiss={onDismiss} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dentro' }))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Fuera' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('considera un panel en portal como parte del componente', () => {
    const onDismiss = vi.fn()
    render(<Fixture onDismiss={onDismiss} withPortal />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Portal' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('cierra con Escape', () => {
    const onDismiss = vi.fn()
    render(<Fixture onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

