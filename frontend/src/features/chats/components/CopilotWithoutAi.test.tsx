import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatSuggestions } from '../hooks/useChatWorkspace'
import { SuggestionsColumn } from './ChatWorkspaceParts'
import { LeadPanelTabs } from './LeadPanelTabs'

const ai = vi.hoisted(() => ({ available: true }))

vi.mock('../../ai/public/useAiUsage', () => ({ useAiAvailable: () => ai.available }))

const suggestions = {} as ChatSuggestions

describe('Copiloto según el paquete', () => {
  beforeEach(() => {
    ai.available = true
  })

  it('con IA, sin chat abierto, la columna invita a elegir un lead', () => {
    render(<SuggestionsColumn selectedChat={null} suggestions={suggestions} canConnect={false} onUse={() => {}} />)

    expect(screen.getByText(/Selecciona un lead para ver las sugerencias/)).toBeInTheDocument()
  })

  it('sin IA en el paquete, sin chat abierto, la columna no ocupa espacio', () => {
    ai.available = false
    const { container } = render(<SuggestionsColumn selectedChat={null} suggestions={suggestions} canConnect={false} onUse={() => {}} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('sin IA el panel del lead muestra solo la ficha', () => {
    render(<LeadPanelTabs tab="ficha" onChange={() => {}} canRegenerate={false} isGenerating={false} onRegenerate={() => {}} tabs={['ficha']} />)

    expect(screen.getByRole('tab', { name: 'Ficha' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Copiloto IA' })).not.toBeInTheDocument()
  })
})
