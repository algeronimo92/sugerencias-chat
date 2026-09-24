import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LeadStageAdminDefinition } from '../types'
import { LeadStagesManagementPanel } from './LeadStagesManagementPanel'

const mocks = vi.hoisted(() => ({
  stages: [] as LeadStageAdminDefinition[],
  create: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../hooks/useLeadStages', () => ({
  useAdminLeadStages: () => ({ data: mocks.stages, isLoading: false, error: null, refetch: vi.fn() }),
  useCreateLeadStage: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateLeadStage: () => ({ mutate: mocks.update, isPending: false, variables: undefined }),
  useReorderLeadStages: () => ({ mutate: mocks.reorder, isPending: false }),
  useDeleteLeadStage: () => ({ mutate: mocks.remove, isPending: false }),
}))

function stage(key: string, name: string, position: number, overrides: Partial<LeadStageAdminDefinition> = {}): LeadStageAdminDefinition {
  return {
    key, name, position, color: '#0ea5e9', kind: 'open', is_active: true,
    description: null, is_system: key === 'nuevo', lead_count: 0, ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stages = [
    stage('nuevo', 'Nuevo', 0, { lead_count: 4 }),
    stage('calificado', 'Calificado', 1, { lead_count: 2 }),
    stage('cita_pagada', 'Cita pagada', 2, { kind: 'won' }),
  ]
})

describe('LeadStagesManagementPanel', () => {
  it('lista las etapas en el orden del embudo con sus leads', () => {
    render(<LeadStagesManagementPanel />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByLabelText('Nombre de Nuevo')).toHaveValue('Nuevo')
    expect(within(items[0]).getByText('4 leads')).toBeInTheDocument()
    expect(within(items[2]).getByText('cita_pagada')).toBeInTheDocument()
  })

  it('crea una etapa con nombre, tipo y color', async () => {
    const user = userEvent.setup()
    render(<LeadStagesManagementPanel />)

    await user.type(screen.getByLabelText('Nombre de la nueva etapa'), '  Cita pagada ')
    await user.click(within(screen.getByRole('radiogroup', { name: 'Color de la nueva etapa' })).getByRole('radio', { name: 'Verde' }))
    await user.click(screen.getByRole('button', { name: /Crear etapa/ }))

    expect(mocks.create).toHaveBeenCalledWith(
      { name: 'Cita pagada', color: '#22c55e', kind: 'open', description: null },
      expect.anything(),
    )
  })

  it('reordena enviando el orden completo de claves', async () => {
    const user = userEvent.setup()
    render(<LeadStagesManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Bajar Calificado' }))

    expect(mocks.reorder).toHaveBeenCalledWith(['nuevo', 'cita_pagada', 'calificado'], expect.anything())
    expect(screen.getByRole('button', { name: 'Subir Nuevo' })).toBeDisabled()
  })

  it('solo guarda lo que cambió', async () => {
    const user = userEvent.setup()
    render(<LeadStagesManagementPanel />)

    const name = screen.getByLabelText('Nombre de Calificado')
    await user.clear(name)
    await user.type(name, 'Interesado')
    await user.click(screen.getByRole('button', { name: 'Guardar Calificado' }))

    expect(mocks.update).toHaveBeenCalledWith({ key: 'calificado', name: 'Interesado' }, expect.anything())
  })

  it('protege la etapa inicial y no ofrece borrar una etapa con leads', () => {
    render(<LeadStagesManagementPanel />)

    expect(screen.queryByRole('button', { name: 'Desactivar Nuevo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar Nuevo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar Calificado' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar Calificado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar Cita pagada' })).toBeInTheDocument()
  })

  it('pide confirmación antes de eliminar', async () => {
    const user = userEvent.setup()
    render(<LeadStagesManagementPanel />)

    await user.click(screen.getByRole('button', { name: 'Eliminar Cita pagada' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar' }))

    expect(mocks.remove).toHaveBeenCalledWith('cita_pagada', expect.anything())
  })
})
