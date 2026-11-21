/**
 * La tarjeta "Del anuncio" abre el anuncio dentro del CRM, como WhatsApp, en
 * vez de mandar a Facebook; Facebook queda como enlace aparte en el detalle.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AdReferralCard } from './AdReferralCard'

const AD = {
  title: 'CITAS AQUÍ',
  body: '¡Realza la belleza natural de tu rostro!\nAgenda tu evaluación gratuita.',
  sourceUrl: 'https://fb.me/abc123',
  thumbnailUrl: 'https://cdn.example/t.jpg',
  ctwaClid: 'clid',
}

describe('AdReferralCard', () => {
  it('abre el detalle del anuncio sin salir del CRM', async () => {
    const user = userEvent.setup()
    render(<AdReferralCard ad={AD} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver el anuncio CITAS AQUÍ' }))

    const dialog = screen.getByRole('dialog', { name: 'CITAS AQUÍ' })
    expect(dialog).toHaveTextContent('Agenda tu evaluación gratuita.')
    expect(screen.getByRole('img', { name: 'Imagen del anuncio CITAS AQUÍ' })).toHaveAttribute('src', AD.thumbnailUrl)
    expect(screen.getByRole('link', { name: 'Ver en Facebook' })).toHaveAttribute('href', AD.sourceUrl)

    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('los toques dentro del detalle no llegan a la burbuja del mensaje', async () => {
    const onBubbleClick = vi.fn()
    const user = userEvent.setup()
    render(
      <div onClick={onBubbleClick}>
        <AdReferralCard ad={AD} />
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Ver el anuncio CITAS AQUÍ' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(onBubbleClick).not.toHaveBeenCalled()
  })

  it('sin link de Facebook el detalle no ofrece el enlace', async () => {
    const user = userEvent.setup()
    render(<AdReferralCard ad={{ ...AD, sourceUrl: null }} />)

    await user.click(screen.getByRole('button', { name: 'Ver el anuncio CITAS AQUÍ' }))

    expect(screen.queryByRole('link', { name: 'Ver en Facebook' })).not.toBeInTheDocument()
  })
})
