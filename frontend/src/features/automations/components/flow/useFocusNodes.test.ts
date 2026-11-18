import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useFocusNodes } from './useFocusNodes'

const state = vi.hoisted(() => ({ initialized: true }))

vi.mock('@xyflow/react', () => ({
  useNodesInitialized: () => state.initialized,
}))

type Focus = { ids: string[]; key: number } | null

function setup(focus: Focus) {
  const fitView = vi.fn().mockResolvedValue(true)
  const wrapper = createRef<HTMLDivElement>()
  const hook = renderHook(({ current }: { current: Focus }) => useFocusNodes(wrapper, current, fitView), {
    initialProps: { current: focus },
  })
  return { fitView, hook }
}

describe('useFocusNodes', () => {
  it('no vuelve a acercar cuando React Flow re-mide los bloques al elegir uno', () => {
    state.initialized = true
    const focus = { ids: ['b7'], key: 1 }
    const { fitView, hook } = setup(focus)
    expect(fitView).toHaveBeenCalledTimes(1)

    // Clic en otro bloque: se rearma, se vuelve a medir y el indicador va y viene.
    state.initialized = false
    hook.rerender({ current: focus })
    state.initialized = true
    hook.rerender({ current: focus })

    expect(fitView).toHaveBeenCalledTimes(1)
  })

  it('acerca de nuevo con cada pedido de «ir a»', () => {
    state.initialized = true
    const { fitView, hook } = setup({ ids: ['b7'], key: 1 })

    hook.rerender({ current: { ids: ['b7'], key: 2 } })

    expect(fitView).toHaveBeenCalledTimes(2)
    expect(fitView).toHaveBeenLastCalledWith(expect.objectContaining({ nodes: [{ id: 'b7' }] }))
  })

  it('espera a que los bloques estén medidos para acercar', () => {
    state.initialized = false
    const focus = { ids: ['b3'], key: 1 }
    const { fitView, hook } = setup(focus)
    expect(fitView).not.toHaveBeenCalled()

    state.initialized = true
    hook.rerender({ current: focus })
    expect(fitView).toHaveBeenCalledTimes(1)
  })
})
