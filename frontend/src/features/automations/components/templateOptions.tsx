import type { MessageTemplate } from '../../templates/types'
import { isMetaTemplate } from '../domain/automaticTemplates'

/**
 * Las plantillas que puede mandar una automatización, en dos grupos: las de
 * Meta se comportan distinto (salen con la ventana cerrada y se cobran).
 * Función y no componente por lo mismo que `actionTypeOptions`: `Select` solo
 * lee los `<optgroup>` de sus hijos directos.
 */
export function templateOptions(templates: MessageTemplate[]) {
  const internal = templates.filter(template => !isMetaTemplate(template))
  const meta = templates.filter(isMetaTemplate)
  return [
    internal.length > 0 && <optgroup key="internal" label="Plantillas internas (ventana de 24 h abierta)">
      {internal.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
    </optgroup>,
    meta.length > 0 && <optgroup key="meta" label="Plantillas de Meta aprobadas">
      {meta.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
    </optgroup>,
  ]
}
