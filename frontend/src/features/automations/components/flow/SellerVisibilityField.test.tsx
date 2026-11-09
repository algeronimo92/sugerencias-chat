import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SellerVisibilityField } from './SellerVisibilityField'

describe('SellerVisibilityField', () => {
  it('desmarcado avisa que los vendedores no lo ven', () => {
    render(<SellerVisibilityField visible={false} saved onChange={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('solo los administradores pueden iniciarlo')
  })

  it('marcarlo se guarda al instante', async () => {
    const onChange = vi.fn()
    render(<SellerVisibilityField visible={false} saved onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('sin guardar el borrador no se puede tocar', () => {
    render(<SellerVisibilityField visible={false} saved={false} onChange={() => {}} />)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
