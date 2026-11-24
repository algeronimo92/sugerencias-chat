/**
 * El estado pedido tiene que llegar al backend: antes se mandaba la global
 * `window.status` ("") y la lista de pendientes traía también completadas y
 * canceladas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../shared/http/client', () => ({ default: api }))

import { fetchTasks } from './api'

describe('fetchTasks', () => {
  beforeEach(() => api.get.mockReset().mockResolvedValue({ data: [] }))

  it('manda el estado pedido', async () => {
    await fetchTasks('pending', 'lead-1', undefined, false)
    expect(api.get).toHaveBeenCalledWith('/api/tasks', {
      params: { status: 'pending', lead_id: 'lead-1', assigned_user_id: undefined, all_users: undefined },
    })
  })

  it('sin estado no manda ninguno', async () => {
    await fetchTasks(undefined, undefined, undefined, true)
    expect(api.get.mock.calls[0][1].params.status).toBeUndefined()
  })
})
