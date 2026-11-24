import { describe, expect, it } from 'vitest'
import { launchersByRule } from './automationFlow'

function rule(id: number, name: string, targets: number[], overrides: object = {}) {
  return {
    id, name, is_active: true,
    published_flow_definition: {
      conditions: {},
      nodes: targets.map(target => ({ id: `n${target}`, type: 'invoke_flow', position: { x: 0, y: 0 }, data: { flow_rule_id: target } })),
      edges: [],
    },
    ...overrides,
  } as never
}

describe('launchersByRule', () => {
  it('names every automation that launches another, once', () => {
    const launchers = launchersByRule([rule(3, 'Bienvenida', [1, 4, 1]), rule(7, 'Reactivación', [1]), rule(1, 'Hollywood peel', [])])

    expect(launchers.get(1)).toEqual(['Bienvenida', 'Reactivación'])
    expect(launchers.get(4)).toEqual(['Bienvenida'])
    expect(launchers.has(3)).toBe(false)
  })

  it('ignores what cannot launch anything: paused or never published', () => {
    const launchers = launchersByRule([
      rule(3, 'Bienvenida', [1], { is_active: false }),
      rule(5, 'Borrador', [1], { published_flow_definition: null }),
    ])

    expect(launchers.size).toBe(0)
  })
})
