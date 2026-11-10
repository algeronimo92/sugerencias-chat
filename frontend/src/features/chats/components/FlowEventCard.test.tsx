import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AutomationExecution } from '../../automations/types'
import { FlowEventCard } from './FlowEventCard'

function execution(overrides: Partial<AutomationExecution> = {}): AutomationExecution {
  return {
    id: 63802,
    rule_id: 8,
    rule_name: 'Ubicacion',
    rule_deleted: false,
    parent_execution_id: null,
    parent_rule_id: null,
    parent_rule_name: null,
    lead_id: 'lead-1',
    lead_name: 'Jose',
    trigger_type: 'manual',
    status: 'completed',
    scheduled_for: '2026-11-09T15:03:06.000000Z',
    paused_at: null,
    pause_scope: null,
    started_at: '2026-11-09T15:03:06.000000Z',
    finished_at: '2026-11-09T15:03:06.500000Z',
    action_results: [],
    flow_state: {},
    error: null,
    error_code: null,
    created_at: '2026-11-09T15:03:06.000000Z',
    start_source: 'manual',
    started_by_user_id: 7,
    started_by_name: 'Grecia Geronimo',
    window_override_at: null,
    window_override_by_name: null,
    ...overrides,
  } as AutomationExecution
}

describe('FlowEventCard', () => {
  it('dice quién lanzó el flujo y que terminó', () => {
    render(<FlowEventCard execution={execution()} />)

    expect(screen.getByText(/Grecia Geronimo inició el flujo/)).toBeInTheDocument()
    expect(screen.getByText('Ubicacion')).toBeInTheDocument()
    expect(screen.getByText(/Completado/)).toBeInTheDocument()
  })

  it('nombra al flujo padre cuando lo llamó otro flujo', () => {
    render(<FlowEventCard execution={execution({ start_source: 'flow', started_by_name: null, parent_rule_name: 'Hollywood peel' })} />)

    expect(screen.getByText(/El flujo Hollywood peel inició/)).toBeInTheDocument()
  })

  it('muestra el motivo cuando la ejecución falló', () => {
    render(<FlowEventCard execution={execution({ status: 'failed', error: 'La ventana de 24 h está cerrada' })} />)

    expect(screen.getByText(/Con error/)).toBeInTheDocument()
    expect(screen.getByText('La ventana de 24 h está cerrada')).toBeInTheDocument()
  })
})
