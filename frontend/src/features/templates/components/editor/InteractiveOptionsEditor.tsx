import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { Checkbox } from '../../../../shared/ui/Checkbox'
import { fieldId } from '../../domain/fieldLimits'
import type { EditableListSection } from '../../domain/interactiveConfig'
import { nextFreeId } from '../../domain/templateDraft'
import { useRowKeys } from '../../hooks/useRowKeys'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { InteractiveLimits } from '../../types'
import { CountedInput, FieldErrors, FieldLabel } from './parts'

interface Props {
  editor: TemplateEditorState
  limits: InteractiveLimits | undefined
  defaultFooter: string | undefined
}

interface OptionsProps {
  editor: TemplateEditorState
  limits: InteractiveLimits | undefined
  showIds: boolean
}

/** Los botones de respuesta de una plantilla interna. */
function ReplyButtonsEditor({ editor, limits, showIds }: OptionsProps) {
  const { form, change, errorsFor } = editor
  const rows = useRowKeys(form.interactiveButtons.length)
  const max = limits?.max_buttons ?? 3
  const update = (index: number, patch: { title?: string; id?: string }) =>
    change(current => ({ interactiveButtons: current.interactiveButtons.map((item, position) => position === index ? { ...item, ...patch } : item) }))

  function remove(index: number) {
    rows.removeAt(index)
    change(current => ({ interactiveButtons: current.interactiveButtons.filter((_, position) => position !== index) }))
  }

  return (
    <fieldset id={fieldId('interactiveButtons')} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      <legend className="mb-1.5 text-sm font-medium text-fg">Botones de respuesta <span className="font-normal text-fg-muted">(hasta {max})</span></legend>
      {form.interactiveButtons.map((button, index) => (
        <div key={rows.keys[index]} className="flex flex-wrap items-center gap-2">
          <CountedInput aria-label={`Texto del botón ${index + 1}`} value={button.title} max={limits?.button_text} placeholder="Texto del botón" onChange={event => update(index, { title: event.target.value })} />
          {showIds && <CountedInput aria-label={`ID del botón ${index + 1}`} quiet value={button.id} max={limits?.button_id} placeholder="ID para automatizaciones" onChange={event => update(index, { id: event.target.value })} />}
          <Button variant="ghost" size="icon" aria-label={`Quitar botón ${index + 1}`} disabled={form.interactiveButtons.length === 1} onClick={() => remove(index)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {form.interactiveButtons.length < max && (
        <div>
          <Button variant="link" size="sm" onClick={() => change(current => ({ interactiveButtons: [...current.interactiveButtons, { id: nextFreeId('reply_', current.interactiveButtons.map(item => item.id)), title: '' }] }))}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar botón
          </Button>
        </div>
      )}
      <p className="text-xs text-fg-muted">Fuera de una plantilla oficial, WhatsApp solo admite botones de respuesta. Para un enlace o una llamada, usa una oficial.</p>
      <FieldErrors messages={errorsFor('interactiveButtons')} />
    </fieldset>
  )
}

interface SectionProps {
  section: EditableListSection
  position: number
  limits: InteractiveLimits | undefined
  showIds: boolean
  /** Solo queda esta sección: no se puede quitar. */
  only: boolean
  canAddRow: boolean
  /** Un ID de opción que no esté en uso en ninguna sección. */
  nextRowId: () => string
  onChange: (section: EditableListSection) => void
  onRemove: () => void
}

/** Una sección de la lista con sus opciones. */
function ListSectionEditor({ section, position, limits, showIds, only, canAddRow, nextRowId, onChange, onRemove }: SectionProps) {
  const rows = useRowKeys(section.rows.length)
  const updateRow = (index: number, patch: Partial<EditableListSection['rows'][number]>) =>
    onChange({ ...section, rows: section.rows.map((row, rowPosition) => rowPosition === index ? { ...row, ...patch } : row) })

  function removeRow(index: number) {
    rows.removeAt(index)
    onChange({ ...section, rows: section.rows.filter((_, rowPosition) => rowPosition !== index) })
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex items-center gap-2">
        <CountedInput aria-label={`Título de la sección ${position}`} value={section.title} max={limits?.section_title} placeholder="Título de la sección" onChange={event => onChange({ ...section, title: event.target.value })} />
        <Button variant="ghost" size="icon" aria-label={`Quitar sección ${position}`} disabled={only} onClick={onRemove}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {section.rows.map((row, index) => {
        const name = `la opción ${index + 1} de la sección ${position}`
        return (
          <div key={rows.keys[index]} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <CountedInput aria-label={`Texto de ${name}`} value={row.title} max={limits?.row_title} placeholder="Opción" onChange={event => updateRow(index, { title: event.target.value })} />
            <CountedInput aria-label={`Descripción de ${name}`} value={row.description} max={limits?.row_description} placeholder="Descripción (opcional)" onChange={event => updateRow(index, { description: event.target.value })} />
            {showIds && <CountedInput aria-label={`ID de ${name}`} quiet value={row.id} max={limits?.row_id} placeholder="ID para automatizaciones" onChange={event => updateRow(index, { id: event.target.value })} />}
            <Button variant="ghost" size="icon" aria-label={`Quitar ${name}`} disabled={section.rows.length === 1} onClick={() => removeRow(index)}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )
      })}
      {canAddRow && (
        <div>
          <Button variant="link" size="sm" onClick={() => onChange({ ...section, rows: [...section.rows, { id: nextRowId(), title: '', description: '' }] })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar opción
          </Button>
        </div>
      )}
    </div>
  )
}

/** El botón que abre la lista y sus secciones. */
function ListOptionsEditor({ editor, limits, showIds }: OptionsProps) {
  const { form, change, errorsFor } = editor
  const sections = useRowKeys(form.interactiveSections.length)
  const totalRows = form.interactiveSections.reduce((total, section) => total + section.rows.length, 0)
  const maxRows = limits?.max_rows ?? 10
  const canAddRow = totalRows < maxRows
  const canAddSection = canAddRow && form.interactiveSections.length < (limits?.max_sections ?? 10)
  const nextRowId = () => nextFreeId('option_', form.interactiveSections.flatMap(section => section.rows.map(row => row.id)))

  function removeSection(index: number) {
    sections.removeAt(index)
    change(current => ({ interactiveSections: current.interactiveSections.filter((_, position) => position !== index) }))
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel htmlFor={fieldId('interactiveButtonText')} required>Texto del botón que abre la lista</FieldLabel>
        <CountedInput id={fieldId('interactiveButtonText')} value={form.interactiveButtonText} max={limits?.list_button_text} placeholder="Ver opciones" onChange={event => change({ interactiveButtonText: event.target.value })} />
        <div className="mt-1.5"><FieldErrors messages={errorsFor('interactiveButtonText')} /></div>
      </div>
      <fieldset id={fieldId('interactiveSections')} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <legend className="mb-1.5 text-sm font-medium text-fg">Opciones de la lista <span className="font-normal tabular-nums text-fg-muted">({totalRows} de {maxRows})</span></legend>
        {form.interactiveSections.map((section, index) => (
          <ListSectionEditor
            key={sections.keys[index]}
            section={section}
            position={index + 1}
            limits={limits}
            showIds={showIds}
            only={form.interactiveSections.length === 1}
            canAddRow={canAddRow}
            nextRowId={nextRowId}
            onChange={next => change(current => ({ interactiveSections: current.interactiveSections.map((item, position) => position === index ? next : item) }))}
            onRemove={() => removeSection(index)}
          />
        ))}
        {canAddSection && (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => change(current => ({
                interactiveSections: [...current.interactiveSections, { title: `Sección ${current.interactiveSections.length + 1}`, rows: [{ id: nextRowId(), title: '', description: '' }] }],
              }))}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar sección
            </Button>
          </div>
        )}
        <FieldErrors messages={errorsFor('interactiveSections')} />
      </fieldset>
    </div>
  )
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

      {form.interactiveType === 'button'
        ? <ReplyButtonsEditor editor={editor} limits={limits} showIds={showIds} />
        : <ListOptionsEditor editor={editor} limits={limits} showIds={showIds} />}

      <label className="flex items-start gap-2 text-sm text-fg">
        <Checkbox checked={showIds} onCheckedChange={checked => setShowIds(checked === true)} />
        <span>
          Mostrar los ID de cada opción
          <span className="block text-xs text-fg-muted">El cliente no los ve. Las automatizaciones los usan para saber qué eligió; solo cámbialos si una automatización ya depende de ellos.</span>
        </span>
      </label>
    </div>
  )
}
