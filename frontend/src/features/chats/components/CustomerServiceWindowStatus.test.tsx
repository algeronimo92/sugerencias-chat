import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CustomerServiceWindow } from '../types'
import { CustomerServiceWindowBadge, CustomerServiceWindowNotice } from './CustomerServiceWindowStatus'

const inHours = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString()

function windowOf(overrides: Partial<CustomerServiceWindow>): CustomerServiceWindow {
  return {
    is_open: false,
    last_customer_message_at: inHours(-30),
    expires_at: inHours(-6),
    seconds_remaining: 0,
    free_entry_point_open: false,
    free_entry_point_expires_at: null,
    ad_reply_deadline: null,
    ...overrides,
  }
}

describe('ventana gratis por anuncio', () => {
  it('pide responder a tiempo a quien llegó por un anuncio, aunque queden horas de ventana', () => {
    render(<CustomerServiceWindowNotice data={windowOf({
      is_open: true, expires_at: inHours(20), seconds_remaining: 72000, ad_reply_deadline: inHours(20),
    })} />)

    expect(screen.getByText('Llegó por un anuncio.')).toBeInTheDocument()
  })

  it('con las 24 h vencidas sigue exigiendo plantillas, pero avisa que son gratis', () => {
    const data = windowOf({ free_entry_point_open: true, free_entry_point_expires_at: inHours(100) })
    render(<>
      <CustomerServiceWindowBadge data={data} isLoading={false} />
      <CustomerServiceWindowNotice data={data} />
    </>)

    expect(screen.getByText(/Plantillas gratis/)).toBeInTheDocument()
    expect(screen.getByText('Venció la ventana de 24 h, pero las plantillas son gratis')).toBeInTheDocument()
    expect(screen.queryByText('Venció el plazo para responder')).not.toBeInTheDocument()
  })

  it('sin anuncio, la ventana vencida se ve como siempre', () => {
    render(<CustomerServiceWindowBadge data={windowOf({})} isLoading={false} />)

    expect(screen.getByText('Venció el plazo para responder')).toBeInTheDocument()
  })
})
