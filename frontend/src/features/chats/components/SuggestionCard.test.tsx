import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sugerencia } from '../../ai/types'
import { getDraft, resetDraftsForTests, setDraftText } from '../draftStore'
import { SuggestionCard } from './SuggestionCard'

vi.mock('./AudioSuggestionDialog', () => ({ AudioSuggestionDialog: () => null }))

const sugerencia: Sugerencia = {
  tactica: 'Cotizar el pack',
  canal: 'texto',
  texto: 'Hola Ana, el pack x3 cuesta 400.',
  adjuntos: ['https://m/flyer.pdf'],
  motivo_adjuntos: 'El flyer muestra el antes y después del peel.',
  porque: 'Pidió precio dos veces',
}

describe('SuggestionCard', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDraftsForTests()
  })

  it('«Usar» lleva el texto al borrador del chat y avisa a quien lo monta', async () => {
    const onUse = vi.fn()
    render(<SuggestionCard sugerencia={sugerencia} index={0} chatId="lead-1" onUse={onUse} />)

    await userEvent.click(screen.getByRole('button', { name: 'Usar' }))

    expect(getDraft('lead-1')).toBe('Hola Ana, el pack x3 cuesta 400.')
    expect(onUse).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'En el cuadro' })).toBeInTheDocument()
  })

  it('con un borrador a medias lo agrega debajo en vez de pisarlo', async () => {
    setDraftText('lead-1', 'Hola Ana,')
    render(<SuggestionCard sugerencia={sugerencia} index={0} chatId="lead-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Usar' }))

    expect(getDraft('lead-1')).toBe('Hola Ana,\nHola Ana, el pack x3 cuesta 400.')
  })

  it('muestra por qué el modelo eligió los adjuntos', () => {
    render(<SuggestionCard sugerencia={sugerencia} index={0} chatId="lead-1" />)
    expect(screen.getByRole('link', { name: 'https://m/flyer.pdf' })).toBeInTheDocument()
    expect(screen.getByText('El flyer muestra el antes y después del peel.')).toBeInTheDocument()
  })
})
