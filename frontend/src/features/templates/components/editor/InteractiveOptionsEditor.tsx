import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { Checkbox } from '../../../../shared/ui/Checkbox'
import { fieldId } from '../../domain/fieldLimits'
import { nextFreeId } from '../../domain/templateDraft'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { InteractiveLimits } from '../../types'
import { CountedInput, FieldErrors, FieldLabel } from './parts'

interface Props {
  editor: TemplateEditorState
  limits: InteractiveLimits | undefined
  defaultFooter: string | undefined
}

/**
 * Los botones de respuesta o la lista de opciones de una plantilla interna.
 *
 * El ID de cada opción no lo ve el cliente: vuelve en su respuesta y las
 * automatizaciones lo usan para ramificar. Se genera solo y queda oculto
 * salvo que se pida verlo; antes era un campo obligatorio más, al lado del
 * texto, y se repetía al quitar un botón y sumar otro.
 */
export function InteractiveOptionsEditor({ editor, limits, defaultFooter }: Props) {
  const { form, change, errorsFor } = editor
  const [showIds, setShowIds] = useState(false)
  const totalRows = form.interactiveSections.reduce((total, section) => total + section.rows.length, 0)
  const maxButtons = limits?.max_buttons ?? 3
  const maxRows = limits?.max_rows ?? 10
  const allRowIds = () => form.interactiveSections.flatMap(section => section.rows.map(row => row.id))

  function updateSection(sectionIndex: number, patch: (section: typeof form.interactiveSections[number]) => typeof form.interactiveSections[number]) {
    change(current => ({
      interactiveSections: current.interactiveSections.map((section, index) => index === sectionIndex ? patch(section) : section),
    }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={fieldId('interactiveTitle')} optional>Encabezado</FieldLabel>
          <CountedInput id={fieldId('interactiveTitle')} value={form.interactiveTitle} max={limits?.title} placeholder="Elige una opción" onChange={event => change({ interactiveTitle: event.target.value })} />
          <div className="mt-1.5"><FieldErrors messages={errorsFor('interactiveTitle')} /></div>
        </div>
        <div>
          <FieldLabel htmlFor={fieldId('interactiveFooter')} optional>Pie</FieldLabel>
          <CountedInput id={fieldId('interactiveFooter')} value={form.interactiveFooter} max={limits?.footer} placeholder={defaultFooter} onChange={event => change({ interactiveFooter: event.target.value })} />
          <div className="mt-1.5"><FieldErrors messages={errorsFor('interactiveFooter')} /></div>
        </div>
      </div>

      {form.interactiveType === 'button' && (
        <fieldset id={fieldId('interactiveButtons')} tabIndex={-1} className="flex flex-col gap-2 outline-none">
          <legend className="mb-1.5 text-sm font-medium text-fg">Botones de respuesta <span className="font-normal text-fg-muted">(hasta {maxButtons})</span></legend>
          {form.interactiveButtons.map((button, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <CountedInput
                aria-label={`Texto del botón ${index + 1}`}
                value={button.title}
                max={limits?.button_text}
                placeholder="Texto del botón"
                onChange={event => change(current => ({ interactiveButtons: current.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))}
              />
              {showIds && (
                <CountedInput
                  aria-label={`ID del botón ${index + 1}`}
                  quiet
                  value={button.id}
                  max={limits?.button_id}
                  placeholder="ID para automatizaciones"
                  onChange={event => change(current => ({ interactiveButtons: current.interactiveButtons.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item) }))}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar botón ${index + 1}`}
                disabled={form.interactiveButtons.length === 1}
                onClick={() => change(current => ({ interactiveButtons: current.interactiveButtons.filter((_, itemIndex) => itemIndex !== index) }))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {form.interactiveButtons.length < maxButtons && (
            <div>
              <Button variant="link" size="sm" onClick={() => change(current => ({ interactiveButtons: [...current.interactiveButtons, { id: nextFreeId('reply_', current.interactiveButtons.map(item => item.id)), title: '' }] }))}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar botón
              </Button>
            </div>
          )}
          <p className="text-xs text-fg-muted">Fuera de una plantilla oficial, WhatsApp solo admite botones de respuesta. Para un enlace o una llamada, usa una oficial.</p>
          <FieldErrors messages={errorsFor('interactiveButtons')} />
        </fieldset>
      )}

      {form.interactiveType === 'list' && (
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel htmlFor={fieldId('interactiveButtonText')} required>Texto del botón que abre la lista</FieldLabel>
            <CountedInput id={fieldId('interactiveButtonText')} value={form.interactiveButtonText} max={limits?.list_button_text} placeholder="Ver opciones" onChange={event => change({ interactiveButtonText: event.target.value })} />
            <div className="mt-1.5"><FieldErrors messages={errorsFor('interactiveButtonText')} /></div>
          </div>
          <fieldset id={fieldId('interactiveSections')} tabIndex={-1} className="flex flex-col gap-3 outline-none">
            <legend className="mb-1.5 text-sm font-medium text-fg">Opciones de la lista <span className="font-normal tabular-nums text-fg-muted">({totalRows} de {maxRows})</span></legend>
            {form.interactiveSections.map((section, sectionIndex) => (
              <div key={sectionIndex} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <CountedInput aria-label={`Título de la sección ${sectionIndex + 1}`} value={section.title} max={limits?.section_title} placeholder="Título de la sección" onChange={event => updateSection(sectionIndex, current => ({ ...current, title: event.target.value }))} />
                  <Button variant="ghost" size="icon" aria-label={`Quitar sección ${sectionIndex + 1}`} disabled={form.interactiveSections.length === 1} onClick={() => change(current => ({ interactiveSections: current.interactiveSections.filter((_, index) => index !== sectionIndex) }))}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                {section.rows.map((row, rowIndex) => {
                  const updateRow = (patch: Partial<typeof row>) => updateSection(sectionIndex, current => ({ ...current, rows: current.rows.map((item, index) => index === rowIndex ? { ...item, ...patch } : item) }))
                  const name = `la opción ${rowIndex + 1} de la sección ${sectionIndex + 1}`
                  return (
                    <div key={rowIndex} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                      <CountedInput aria-label={`Texto de ${name}`} value={row.title} max={limits?.row_title} placeholder="Opción" onChange={event => updateRow({ title: event.target.value })} />
                      <CountedInput aria-label={`Descripción de ${name}`} value={row.description} max={limits?.row_description} placeholder="Descripción (opcional)" onChange={event => updateRow({ description: event.target.value })} />
                      {showIds && <CountedInput aria-label={`ID de ${name}`} quiet value={row.id} max={limits?.row_id} placeholder="ID para automatizaciones" onChange={event => updateRow({ id: event.target.value })} />}
                      <Button variant="ghost" size="icon" aria-label={`Quitar ${name}`} disabled={section.rows.length === 1} onClick={() => updateSection(sectionIndex, current => ({ ...current, rows: current.rows.filter((_, index) => index !== rowIndex) }))}>
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )
                })}
                {totalRows < maxRows && (
                  <div>
                    <Button variant="link" size="sm" onClick={() => updateSection(sectionIndex, current => ({ ...current, rows: [...current.rows, { id: nextFreeId('option_', allRowIds()), title: '', description: '' }] }))}>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar opción
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {form.interactiveSections.length < (limits?.max_sections ?? 10) && totalRows < maxRows && (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => change(current => ({
                    interactiveSections: [...current.interactiveSections, {
                      title: `Sección ${current.interactiveSections.length + 1}`,
                      rows: [{ id: nextFreeId('option_', current.interactiveSections.flatMap(item => item.rows.map(row => row.id))), title: '', description: '' }],
                    }],
                  }))}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar sección
                </Button>
              </div>
            )}
            <FieldErrors messages={errorsFor('interactiveSections')} />
          </fieldset>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-fg">
        <Checkbox checked={showIds} onCheckedChange={checked => setShowIds(checked === true)} />
        <span>
          Mostrar los ID de cada opción
          <span className="block text-xs text-fg-muted">El cliente no los ve. Las automatizaciones los usan para saber qué eligió; solo cámbialos si un flujo ya depende de ellos.</span>
        </span>
      </label>
    </div>
  )
}
