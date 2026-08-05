import type { AutomationRule } from "../types";

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
