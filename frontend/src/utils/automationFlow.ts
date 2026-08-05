import type { AutomationFlowDefinition } from '../types'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function areFlowDefinitionsEqual(
  left: AutomationFlowDefinition | null | undefined,
  right: AutomationFlowDefinition | null | undefined,
): boolean {
  if (left == null || right == null) return left === right
  return stableJson(left) === stableJson(right)
}
