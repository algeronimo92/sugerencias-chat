import { describe, expect, it } from 'vitest'
import { AutomationTrigger, FlowNodeType } from './automationCatalog'
import { FLOW_RECIPES, recipesFor } from './flowRecipes'

const KNOWN_VARIABLES = new Set(['nombre', 'telefono', 'servicio', 'vendedor', 'fecha_actual'])

describe('flow recipes', () => {
  it.each(FLOW_RECIPES)('«$title» is a connected flow from its trigger to an end', recipe => {
    const { name, definition } = recipe.build()
    const ids = definition.nodes.map(node => node.id)

    expect(name.trim()).not.toBe('')
    expect(new Set(ids).size).toBe(ids.length)
    expect(definition.nodes[0].type).toBe(FlowNodeType.Trigger)
    expect(definition.nodes.at(-1)?.type).toBe(FlowNodeType.End)
    // Cada bloque menos el fin tiene exactamente una salida, al siguiente.
    expect(definition.edges.map(edge => [edge.source, edge.target])).toEqual(
      ids.slice(0, -1).map((id, index) => [id, ids[index + 1]]),
    )
  })

  it.each(FLOW_RECIPES)('«$title» only uses variables the engine can fill in', recipe => {
    const text = JSON.stringify(recipe.build().definition)
    const used = Array.from(text.matchAll(/\{\{(\w+)\}\}/g), match => match[1])

    expect(used.filter(name => !KNOWN_VARIABLES.has(name))).toEqual([])
  })

  it('a sequence starts by hand and an automatic one never does', () => {
    const triggerOf = (recipe: (typeof FLOW_RECIPES)[number]) => {
      const first = recipe.build().definition.nodes[0]
      return first.type === FlowNodeType.Trigger ? first.data.trigger_type : null
    }

    expect(recipesFor('sequences').map(triggerOf)).toEqual(recipesFor('sequences').map(() => AutomationTrigger.Manual))
    expect(recipesFor('automatic').map(triggerOf)).not.toContain(AutomationTrigger.Manual)
  })

  it('building twice gives independent definitions', () => {
    const [first, second] = [FLOW_RECIPES[0].build(), FLOW_RECIPES[0].build()]
    first.definition.nodes[0].position.x = 999

    expect(second.definition.nodes[0].position.x).not.toBe(999)
  })

  it('timed triggers carry the minutes the description promises', () => {
    const minutes = Object.fromEntries(FLOW_RECIPES.map(recipe => {
      const first = recipe.build().definition.nodes[0]
      return [recipe.id, first.type === FlowNodeType.Trigger ? first.data.minutes : undefined]
    }))

    expect(minutes['cliente-sin-responder']).toBe(180)
    expect(minutes['vendedora-sin-responder']).toBe(15)
  })
})
