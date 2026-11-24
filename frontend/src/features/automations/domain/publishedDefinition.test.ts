import { describe, expect, it } from 'vitest'
import { asPublishedDefinition } from './publishedDefinition'

describe('asPublishedDefinition', () => {
  it.each([null, undefined, {}, [], 'x', { nodes: [] , edges: [] }, { nodes: [{ id: 'a' }] }, { edges: [] }])(
    'treats %j as not published instead of crashing the editor', value => {
      expect(asPublishedDefinition(value)).toBeNull()
    },
  )

  it('keeps a real definition and fills in missing entry conditions', () => {
    const nodes = [{ id: 'trigger-1' }]
    expect(asPublishedDefinition({ nodes, edges: [] })).toEqual({ nodes, edges: [], conditions: {} })
    expect(asPublishedDefinition({ nodes, edges: [], conditions: { business_hours_only: true } })?.conditions).toEqual({ business_hours_only: true })
  })
})
