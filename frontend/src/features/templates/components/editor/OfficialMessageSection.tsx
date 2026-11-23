import { Plus } from 'lucide-react'
import type { RefObject } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { DropdownMenu, DropdownMenuItem } from '../../../../shared/ui/DropdownMenu'
import { MediaAssetField } from '../../../media/public/MediaAssetField'
import type { MediaAsset } from '../../../media/types'
import { TEMPLATE_LIMITS, contentLimit, fieldId } from '../../domain/fieldLimits'
import { APPOINTMENT_SOURCES, LEAD_SOURCES } from '../../domain/officialParameters'
import { insertDataVariable } from '../../domain/officialVariables'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { InteractiveLimits } from '../../types'
import { MessageField } from './MessageField'
import { OfficialButtonsEditor } from './OfficialButtonsEditor'
import { OfficialVariablesList } from './OfficialVariablesList'
import { ChoicePill, CountedInput, EditorSection, FieldErrors, FieldLabel } from './parts'

interface Props {
  editor: TemplateEditorState
  limits: InteractiveLimits | undefined
  mediaAssets: MediaAsset[]
}

/** Qué decir cuando Meta no deja tocar el mensaje. */
const LOCKED_HINT = 'Meta no acepta cambios en el mensaje por ahora. Puedes cambiar el nombre, la categoría del equipo y el atajo.'

/**
 * El mensaje de una plantilla oficial, de arriba abajo como lo ve el
 * cliente: encabezado, texto con sus datos, pie y botones (2026-11-23).
 * Antes el encabezado, el pie y los botones vivían en un bloque de
 * «Configuración de Meta» arriba del texto, y las variables al final.
 */
export function OfficialMessageSection({ editor, limits, mediaAssets }: Props) {
  const { form, change, errorsFor } = editor
  const headerErrors = errorsFor('officialHeader')
  const footerErrors = errorsFor('officialFooter')
  const locked = editor.metaRules.contentLocked

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

  return (
    <EditorSection title="Mensaje" description={locked ? LOCKED_HINT : 'De arriba abajo, en el orden en que lo verá el cliente.'}>
      {/* Un <fieldset> deshabilitado bloquea de una vez todos los campos y
          botones que contiene, incluidos los que se agreguen después. */}
      <fieldset disabled={locked} className="min-w-0">
        <div className="flex flex-col gap-4">
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

      <OfficialButtonsEditor editor={editor} />
        </div>
      </fieldset>
    </EditorSection>
  )
}
