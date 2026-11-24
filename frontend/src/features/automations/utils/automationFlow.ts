import type { AutomationRule } from '../types';

type ComparableFlowDefinition =
  | AutomationRule["flow_definition"]
  | AutomationRule["published_flow_definition"]
  | undefined;

export function areFlowDefinitionsEqual(
  left: ComparableFlowDefinition,
  right: ComparableFlowDefinition,
): boolean {
  if (left == null || right == null) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Por cada automatización, los nombres de las que la lanzan con un paso
 * «Iniciar otro flujo». Solo cuenta lo publicado y activo: un borrador o una
 * automatización en pausa no lanza nada.
 */
export function launchersByRule(
  rules: Pick<AutomationRule, 'id' | 'name' | 'is_active' | 'published_flow_definition'>[],
): Map<number, string[]> {
  const launchers = new Map<number, string[]>();
  for (const rule of rules) {
    const definition = rule.published_flow_definition;
    if (!rule.is_active || !definition || !('nodes' in definition)) continue;
    for (const node of definition.nodes) {
      const target = node.type === 'invoke_flow' ? Number((node.data as { flow_rule_id?: unknown }).flow_rule_id) : NaN;
      if (!Number.isInteger(target) || target === rule.id) continue;
      const names = launchers.get(target) ?? [];
      if (!names.includes(rule.name)) launchers.set(target, [...names, rule.name]);
    }
  }
  return launchers;
}
