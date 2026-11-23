import { Plus, X } from 'lucide-react'
import type { RefObject } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { DropdownMenu, DropdownMenuItem } from '../../../../shared/ui/DropdownMenu'
import { Select } from '../../../../shared/ui/Input'
import { MediaAssetField } from '../../../media/public/MediaAssetField'
import type { MediaAsset } from '../../../media/types'
import { TEMPLATE_LIMITS, contentLimit, fieldId } from '../../domain/fieldLimits'
import { APPOINTMENT_SOURCES, LEAD_SOURCES } from '../../domain/officialParameters'
import { insertDataVariable } from '../../domain/officialVariables'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { InteractiveLimits, OfficialTemplateButton } from '../../types'
import { MessageField } from './MessageField'
import { OfficialVariablesList } from './OfficialVariablesList'
import { ChoicePill, CountedInput, EditorSection, FieldErrors, FieldLabel } from './parts'

type ButtonsKind = 'none' | 'quick' | 'action'

function buttonsKind(buttons: OfficialTemplateButton[]): ButtonsKind {
  if (buttons.length === 0) return 'none'
  return buttons.every(button => button.type === 'quick_reply') ? 'quick' : 'action'
}

const MAX_BUTTONS: Record<Exclude<ButtonsKind, 'none'>, number> = { quick: 3, action: 2 }

interface Props {
  editor: TemplateEditorState
  limits: InteractiveLimits | undefined
  mediaAssets: MediaAsset[]
}

/**
 * El mensaje de una plantilla oficial, de arriba abajo como lo ve el
 * cliente: encabezado, texto con sus datos, pie y botones (2026-11-23).
 * Antes el encabezado, el pie y los botones vivían en un bloque de
 * «Configuración de Meta» arriba del texto, y las variables al final.
 */
export function OfficialMessageSection({ editor, limits, mediaAssets }: Props) {
  const { form, change, errorsFor } = editor
  const kind = buttonsKind(form.officialButtons)
  const headerErrors = errorsFor('officialHeader')
  const footerErrors = errorsFor('officialFooter')
  const buttonErrors = errorsFor('officialButtons')

  function insertData(sourceKey: string, field: RefObject<HTMLTextAreaElement | null>) {
    const next = insertDataVariable(field.current, form.content, form.officialParameterValues, sourceKey)
    const max = contentLimit(form, limits)
    if (max !== undefined && next.content.length > max) return
    change({ content: next.content, officialParameterValues: next.values })
    requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  function setButtonsKind(next: ButtonsKind) {
    if (next === kind) return
    change({
      officialButtons: next === 'none' ? [] : [next === 'quick' ? { type: 'quick_reply', text: '' } : { type: 'url', text: '', url: '' }],
    })
  }

  function updateButton(index: number, patch: Partial<OfficialTemplateButton>) {
    change(current => ({
      officialButtons: current.officialButtons.map((button, buttonIndex) => buttonIndex === index ? { ...button, ...patch } : button),
    }))
  }

  return (
    <EditorSection title="Mensaje" description="De arriba abajo, en el orden en que lo verá el cliente.">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-fg">Encabezado <span className="font-normal text-fg-muted">(opcional)</span></legend>
        <div className="flex flex-wrap gap-2">
          <ChoicePill name="official-header" title="Sin encabezado" checked={form.officialHeaderType === 'none'} onSelect={() => change({ officialHeaderType: 'none' })} />
          <ChoicePill name="official-header" title="Texto" checked={form.officialHeaderType === 'text'} onSelect={() => change({ officialHeaderType: 'text' })} />
          <ChoicePill name="official-header" title="Imagen" checked={form.officialHeaderType === 'image'} onSelect={() => change({ officialHeaderType: 'image' })} />
        </div>
        {form.officialHeaderType === 'text' && (
          <CountedInput
            id={fieldId('officialHeader')}
            aria-label="Texto del encabezado"
            aria-invalid={headerErrors.length > 0 || undefined}
            value={form.officialHeaderText}
            max={TEMPLATE_LIMITS.officialHeaderText}
            placeholder="Un título breve, sin datos"
            onChange={event => change({ officialHeaderText: event.target.value })}
          />
        )}
        {form.officialHeaderType === 'image' && (
          <div id={fieldId('officialHeader')} tabIndex={-1} className="outline-none">
            <MediaAssetField mediaAssetId={form.officialHeaderMediaAssetId} mediaAssets={mediaAssets} kind="image" onChange={assetId => change({ officialHeaderMediaAssetId: assetId })} />
            <p className="mt-1.5 text-xs text-fg-muted">Se envía a Meta como ejemplo del encabezado al guardar.</p>
          </div>
        )}
        <FieldErrors messages={headerErrors} />
      </fieldset>

      <MessageField
        id={fieldId('content')}
        label="Texto del mensaje"
        value={form.content}
        max={contentLimit(form, limits)}
        placeholder="Hola, te escribimos de la clínica para…"
        errors={errorsFor('content')}
        onChange={content => change({ content })}
        insertTools={field => (
          <DropdownMenu
            trigger={<Button variant="secondary" size="sm"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Insertar dato</Button>}
          >
            <p className="px-3 pb-1 pt-2 text-xs font-semibold text-fg-muted">Del lead</p>
            {LEAD_SOURCES.map(source => <DropdownMenuItem key={source.key} onSelect={() => insertData(source.key, field)}>{source.label}</DropdownMenuItem>)}
            <p className="px-3 pb-1 pt-3 text-xs font-semibold text-fg-muted">De la cita</p>
            {APPOINTMENT_SOURCES.map(source => <DropdownMenuItem key={source.key} onSelect={() => insertData(source.key, field)}>{source.label}</DropdownMenuItem>)}
          </DropdownMenu>
        )}
      />

      <OfficialVariablesList
        id={fieldId('officialParameterValues')}
        values={form.officialParameterValues}
        errors={errorsFor('officialParameterValues')}
        onChange={officialParameterValues => change({ officialParameterValues })}
      />

      <div>
        <FieldLabel htmlFor={fieldId('officialFooter')} optional>Pie</FieldLabel>
        <CountedInput
          id={fieldId('officialFooter')}
          aria-invalid={footerErrors.length > 0 || undefined}
          value={form.officialFooter}
          max={TEMPLATE_LIMITS.officialFooter}
          placeholder="Texto pequeño al final, sin datos"
          onChange={event => change({ officialFooter: event.target.value })}
        />
        <div className="mt-1.5"><FieldErrors messages={footerErrors} /></div>
      </div>

      <fieldset id={fieldId('officialButtons')} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <legend className="mb-1.5 text-sm font-medium text-fg">Botones <span className="font-normal text-fg-muted">(opcional)</span></legend>
        {/* Meta no deja mezclar respuestas rápidas con enlaces o llamadas:
            elegir el grupo primero hace imposible armar esa combinación. */}
        <div className="flex flex-wrap gap-2">
          <ChoicePill name="official-buttons" title="Sin botones" checked={kind === 'none'} onSelect={() => setButtonsKind('none')} />
          <ChoicePill name="official-buttons" title="Respuestas rápidas (hasta 3)" checked={kind === 'quick'} onSelect={() => setButtonsKind('quick')} />
          <ChoicePill name="official-buttons" title="Enlace o llamada (hasta 2)" checked={kind === 'action'} onSelect={() => setButtonsKind('action')} />
        </div>
        {form.officialButtons.map((button, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            {kind === 'action' && (
              <div className="w-full sm:w-36">
                <Select
                  aria-label={`Tipo del botón ${index + 1}`}
                  value={button.type}
                  onChange={event => updateButton(index, event.target.value === 'url'
                    ? { type: 'url', url: button.url ?? '', phone_number: undefined }
                    : { type: 'phone_number', phone_number: button.phone_number ?? '', url: undefined })}
                >
                  <option value="url">Enlace</option>
                  <option value="phone_number">Llamada</option>
                </Select>
              </div>
            )}
            <CountedInput
              aria-label={`Texto del botón ${index + 1}`}
              value={button.text}
              max={TEMPLATE_LIMITS.officialButtonText}
              placeholder="Texto del botón"
              onChange={event => updateButton(index, { text: event.target.value })}
            />
            {button.type === 'url' && (
              <CountedInput
                aria-label={`Enlace del botón ${index + 1}`}
                type="url"
                inputMode="url"
                quiet
                value={button.url ?? ''}
                max={TEMPLATE_LIMITS.officialButtonUrl}
                placeholder="https://…"
                onChange={event => updateButton(index, { url: event.target.value })}
              />
            )}
            {button.type === 'phone_number' && (
              <CountedInput
                aria-label={`Teléfono del botón ${index + 1}`}
                type="tel"
                inputMode="tel"
                quiet
                value={button.phone_number ?? ''}
                max={TEMPLATE_LIMITS.officialButtonPhone}
                placeholder="+51 987 654 321"
                onChange={event => updateButton(index, { phone_number: event.target.value })}
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Quitar botón ${index + 1}`}
              onClick={() => change(current => ({ officialButtons: current.officialButtons.filter((_, buttonIndex) => buttonIndex !== index) }))}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {kind !== 'none' && form.officialButtons.length < MAX_BUTTONS[kind] && (
          <div>
            <Button
              variant="link"
              size="sm"
              onClick={() => change(current => ({
                officialButtons: [...current.officialButtons, kind === 'quick' ? { type: 'quick_reply', text: '' } : { type: 'url', text: '', url: '' }],
              }))}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />Agregar botón
            </Button>
          </div>
        )}
        <FieldErrors messages={[...new Set(buttonErrors)]} />
      </fieldset>
    </EditorSection>
  )
}
