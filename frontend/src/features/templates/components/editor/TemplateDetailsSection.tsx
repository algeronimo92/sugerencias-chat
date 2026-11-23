import { useState } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { Select } from '../../../../shared/ui/Input'
import { TEMPLATE_LIMITS, fieldId } from '../../domain/fieldLimits'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import { ChoiceCard, CountedInput, EditorSection, FieldErrors, FieldLabel } from './parts'

/** Los idiomas que el equipo usa; Meta admite más, y uno que ya venga en la
 *  plantilla (importada) se conserva aunque no esté acá. */
const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'es_PE', label: 'Español (Perú)' },
  { code: 'es_MX', label: 'Español (México)' },
  { code: 'es_AR', label: 'Español (Argentina)' },
  { code: 'es_ES', label: 'Español (España)' },
  { code: 'en', label: 'Inglés' },
  { code: 'en_US', label: 'Inglés (EE. UU.)' },
  { code: 'pt_BR', label: 'Portugués (Brasil)' },
]

interface FieldProps {
  editor: TemplateEditorState
}

/** Con qué nombre queda registrada en Meta, dicho debajo del nombre visible. */
function OfficialNameHint({ editor, onEdit }: FieldProps & { onEdit: () => void }) {
  const registered = editor.form.officialName
  return (
    <p className="mt-1.5 text-xs text-fg-muted">
      Solo lo ve tu equipo.{' '}
      {registered
        ? <>En Meta se registra como <strong className="font-semibold text-fg">{registered}</strong>.</>
        : 'El nombre para Meta se arma solo a partir de este.'}{' '}
      {!editor.metaLocked && <Button variant="link" size="sm" className="text-xs" onClick={onEdit}>Cambiar</Button>}
    </p>
  )
}

/** El nombre de Meta escrito a mano, para quien no quiere el que se arma solo. */
function OfficialNameField({ editor }: FieldProps) {
  const { form, metaLocked, officialNameEdited, setOfficialName, followName, errorsFor } = editor
  const errors = errorsFor('officialName')
  return (
    <div>
      <FieldLabel htmlFor={fieldId('officialName')}>Nombre en Meta</FieldLabel>
      <CountedInput
        id={fieldId('officialName')}
        quiet
        aria-invalid={errors.length > 0 || undefined}
        value={form.officialName}
        max={TEMPLATE_LIMITS.officialName}
        disabled={metaLocked}
        placeholder="aviso_de_cita"
        onChange={event => setOfficialName(event.target.value)}
      />
      <p className="mt-1.5 text-xs text-fg-muted">
        Solo minúsculas, números y guion bajo. No se puede cambiar después de enviarla.{' '}
        {officialNameEdited && !metaLocked && <Button variant="link" size="sm" className="text-xs" onClick={followName}>Usar el del nombre</Button>}
      </p>
      <div className="mt-1.5"><FieldErrors messages={errors} /></div>
    </div>
  )
}

function LanguageField({ editor }: FieldProps) {
  const { form, change, metaLocked, errorsFor } = editor
  const known = LANGUAGES.some(language => language.code === form.officialLanguage)
  return (
    <div>
      <FieldLabel htmlFor={fieldId('officialLanguage')}>Idioma del mensaje</FieldLabel>
      <Select id={fieldId('officialLanguage')} value={form.officialLanguage} disabled={metaLocked} onChange={event => change({ officialLanguage: event.target.value })}>
        {!known && <option value={form.officialLanguage}>{form.officialLanguage}</option>}
        {LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
      </Select>
      <p className="mt-1.5 text-xs text-fg-muted">
        {metaLocked ? 'Ya fue enviada a Meta: el nombre y el idioma no se pueden cambiar.' : 'Tiene que coincidir con el texto; si no, Meta la rechaza.'}
      </p>
      <div className="mt-1.5"><FieldErrors messages={errorsFor('officialLanguage')} /></div>
    </div>
  )
}

/** «Aviso» o «Promoción»: las categorías de Meta dichas en palabras del equipo. */
function MessageKindField({ editor }: FieldProps) {
  const { form, change } = editor
  const locked = editor.metaRules.categoryLocked
  return (
    <fieldset disabled={locked} className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-fg">Tipo de mensaje para Meta</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <ChoiceCard
          name="official-category"
          title="Aviso"
          description="Algo que el cliente pidió o hizo: citas, pagos, confirmaciones. Meta lo llama Utility."
          checked={form.officialCategory === 'UTILITY'}
          onSelect={() => change({ officialCategory: 'UTILITY' })}
        />
        <ChoiceCard
          name="official-category"
          title="Promoción"
          description="Ofertas, novedades y mensajes para reactivar clientes. Meta lo llama Marketing."
          checked={form.officialCategory === 'MARKETING'}
          onSelect={() => change({ officialCategory: 'MARKETING' })}
        />
      </div>
      {/* «Authentication» ya no se ofrece al crear: exige un formato fijo con
          código de un solo uso que este editor no arma. Una importada que ya
          lo tenga lo conserva. */}
      {locked && <p className="mt-2 text-xs text-fg-muted">Meta no deja cambiar el tipo de una plantilla que ya aprobó o que está revisando. Si necesitas el otro tipo, duplícala y envía la copia.</p>}
      {form.officialCategory === 'AUTHENTICATION' && (
        <p className="mt-2 text-sm text-fg-muted">Esta plantilla es de código de verificación (Authentication). Si eliges otro tipo, Meta la vuelve a revisar.</p>
      )}
    </fieldset>
  )
}

/**
 * Nombre de la plantilla y, en una oficial, lo que Meta necesita saber de
 * ella: idioma y tipo de mensaje (2026-11-23).
 *
 * Antes había dos nombres que escribir (el del equipo y el «nombre para
 * Meta»), el idioma era texto libre con formato `es_PE` y el tipo se elegía
 * entre «Utility», «Marketing» y «Authentication» sin explicación.
 */
export function TemplateDetailsSection({ editor }: FieldProps) {
  const { form, change, errorsFor } = editor
  const official = form.templateType === 'official'
  const nameErrors = errorsFor('name')
  const [editingOfficialName, setEditingOfficialName] = useState(false)
  // Un error en el nombre de Meta lo despliega solo: si no, no se vería.
  const showOfficialName = official && (editingOfficialName || errorsFor('officialName').length > 0)

  return (
    <EditorSection title="Datos de la plantilla">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={official ? undefined : 'sm:col-span-2'}>
          <FieldLabel htmlFor={fieldId('name')} required>Nombre</FieldLabel>
          <CountedInput
            id={fieldId('name')}
            aria-invalid={nameErrors.length > 0 || undefined}
            value={form.name}
            max={TEMPLATE_LIMITS.name}
            placeholder="Ej.: Aviso de cita"
            onChange={event => change({ name: event.target.value })}
          />
          {official && !showOfficialName && <OfficialNameHint editor={editor} onEdit={() => setEditingOfficialName(true)} />}
          <div className="mt-1.5"><FieldErrors messages={nameErrors} /></div>
        </div>
        {official && <LanguageField editor={editor} />}
      </div>
      {showOfficialName && <OfficialNameField editor={editor} />}
      {official && <MessageKindField editor={editor} />}
    </EditorSection>
  )
}
