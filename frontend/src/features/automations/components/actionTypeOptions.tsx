import { AUTOMATION_ACTION_GROUPS, AUTOMATION_ACTION_LABELS } from '../domain/automationCatalog'

/**
 * Las opciones del selector de acción, agrupadas (flujos y reglas simples).
 * Es una función y no un componente: `Select` (shared/ui) lee los `<optgroup>`
 * y `<option>` de sus hijos directos, y dentro de un componente no los ve.
 */
export function actionTypeOptions() {
  return AUTOMATION_ACTION_GROUPS.map(group => (
    <optgroup key={group.label} label={group.label}>
      {group.types.map(type => <option key={type} value={type}>{AUTOMATION_ACTION_LABELS[type]}</option>)}
    </optgroup>
  ))
}
