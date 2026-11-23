import { Plus, X } from 'lucide-react'
import { Button } from '../../../../shared/ui/Button'
import { Select } from '../../../../shared/ui/Input'
import { TEMPLATE_LIMITS, fieldId } from '../../domain/fieldLimits'
import { useRowKeys } from '../../hooks/useRowKeys'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { OfficialTemplateButton } from '../../types'
import { ChoicePill, CountedInput, FieldErrors } from './parts'

type ButtonsKind = 'none' | 'quick' | 'action'

const MAX_BUTTONS: Record<Exclude<ButtonsKind, 'none'>, number> = { quick: 3, action: 2 }

const EMPTY_BUTTON: Record<Exclude<ButtonsKind, 'none'>, OfficialTemplateButton> = {
  quick: { type: 'quick_reply', text: '' },
  action: { type: 'url', text: '', url: '' },
}

function buttonsKind(buttons: OfficialTemplateButton[]): ButtonsKind {
  if (buttons.length === 0) return 'none'
  return buttons.every(button => button.type === 'quick_reply') ? 'quick' : 'action'
}

interface RowProps {
  button: OfficialTemplateButton
  position: number
  onChange: (patch: Partial<OfficialTemplateButton>) => void
  onRemove: () => void
}

function ButtonRow({ button, position, onChange, onRemove }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {button.type !== 'quick_reply' && (
        <div className="w-full sm:w-36">
          <Select
            aria-label={`Tipo del botón ${position}`}
            value={button.type}
            onChange={event => onChange(event.target.value === 'url'
              ? { type: 'url', url: button.url ?? '', phone_number: undefined }
              : { type: 'phone_number', phone_number: button.phone_number ?? '', url: undefined })}
          >
            <option value="url">Enlace</option>
            <option value="phone_number">Llamada</option>
          </Select>
        </div>
      )}
      <CountedInput aria-label={`Texto del botón ${position}`} value={button.text} max={TEMPLATE_LIMITS.officialButtonText} placeholder="Texto del botón" onChange={event => onChange({ text: event.target.value })} />
      {button.type === 'url' && (
        <CountedInput aria-label={`Enlace del botón ${position}`} type="url" inputMode="url" quiet value={button.url ?? ''} max={TEMPLATE_LIMITS.officialButtonUrl} placeholder="https://…" onChange={event => onChange({ url: event.target.value })} />
      )}
      {button.type === 'phone_number' && (
        <CountedInput aria-label={`Teléfono del botón ${position}`} type="tel" inputMode="tel" quiet value={button.phone_number ?? ''} max={TEMPLATE_LIMITS.officialButtonPhone} placeholder="+51 987 654 321" onChange={event => onChange({ phone_number: event.target.value })} />
      )}
      <Button variant="ghost" size="icon" aria-label={`Quitar botón ${position}`} onClick={onRemove}>
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

/**
 * Los botones de una plantilla oficial. Meta no deja mezclar respuestas
 * rápidas con enlaces o llamadas: elegir el grupo primero hace imposible
 * armar esa combinación, que antes solo se descubría al guardar.
 */
export function OfficialButtonsEditor({ editor }: { editor: TemplateEditorState }) {
  const { form, change, errorsFor } = editor
  const rows = useRowKeys(form.officialButtons.length)
  const kind = buttonsKind(form.officialButtons)

  function setKind(next: ButtonsKind) {
    if (next !== kind) change({ officialButtons: next === 'none' ? [] : [{ ...EMPTY_BUTTON[next] }] })
  }

  function remove(index: number) {
    rows.removeAt(index)
    change(current => ({ officialButtons: current.officialButtons.filter((_, position) => position !== index) }))
  }

  return (
    <fieldset id={fieldId('officialButtons')} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      <legend className="mb-1.5 text-sm font-medium text-fg">Botones <span className="font-normal text-fg-muted">(opcional)</span></legend>
      <div className="flex flex-wrap gap-2">
        <ChoicePill name="official-buttons" title="Sin botones" checked={kind === 'none'} onSelect={() => setKind('none')} />
        <ChoicePill name="official-buttons" title="Respuestas rápidas (hasta 3)" checked={kind === 'quick'} onSelect={() => setKind('quick')} />
        <ChoicePill name="official-buttons" title="Enlace o llamada (hasta 2)" checked={kind === 'action'} onSelect={() => setKind('action')} />
      </div>
      {form.officialButtons.map((button, index) => (
        <ButtonRow
          key={rows.keys[index]}
          button={button}
          position={index + 1}
          onChange={patch => change(current => ({ officialButtons: current.officialButtons.map((item, position) => position === index ? { ...item, ...patch } : item) }))}
          onRemove={() => remove(index)}
        />
      ))}
      {kind !== 'none' && form.officialButtons.length < MAX_BUTTONS[kind] && (
        <div>
          <Button variant="link" size="sm" onClick={() => change(current => ({ officialButtons: [...current.officialButtons, { ...EMPTY_BUTTON[kind] }] }))}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar botón
          </Button>
        </div>
      )}
      <FieldErrors messages={[...new Set(errorsFor('officialButtons'))]} />
    </fieldset>
  )
}
