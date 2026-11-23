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

/**
 * Nombre de la plantilla y, en una oficial, lo que Meta necesita saber de
 * ella: idioma y tipo de mensaje (2026-11-23).
 *
 * Antes había dos nombres que escribir (el del equipo y el «nombre para
 * Meta»), el idioma era texto libre con formato `es_PE` y el tipo se elegía
 * entre «Utility», «Marketing» y «Authentication» sin explicación.
 */
export function TemplateDetailsSection({ editor }: { editor: TemplateEditorState }) {
  const { form, change, errorsFor, metaLocked, officialNameEdited, setOfficialName, followName } = editor
  const official = form.templateType === 'official'
  const nameErrors = errorsFor('name')
  const officialNameErrors = errorsFor('officialName')
  const [editingOfficialName, setEditingOfficialName] = useState(false)
  const showOfficialName = editingOfficialName || officialNameErrors.length > 0

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
          {official && !showOfficialName && (
            <p className="mt-1.5 text-xs text-fg-muted">
              Solo lo ve tu equipo.{' '}
              {form.officialName
                ? <>En Meta se registra como <strong className="font-semibold text-fg">{form.officialName}</strong>.</>
                : 'El nombre para Meta se arma solo a partir de este.'}{' '}
              {!metaLocked && <Button variant="link" size="sm" className="text-xs" onClick={() => setEditingOfficialName(true)}>Cambiar</Button>}
            </p>
          )}
          <div className="mt-1.5"><FieldErrors messages={nameErrors} /></div>
        </div>

        {official && (
          <div>
            <FieldLabel htmlFor={fieldId('officialLanguage')}>Idioma del mensaje</FieldLabel>
            <Select
              id={fieldId('officialLanguage')}
              value={form.officialLanguage}
              disabled={metaLocked}
              onChange={event => change({ officialLanguage: event.target.value })}
            >
              {!LANGUAGES.some(language => language.code === form.officialLanguage) && <option value={form.officialLanguage}>{form.officialLanguage}</option>}
              {LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
            </Select>
            <p className="mt-1.5 text-xs text-fg-muted">
              {metaLocked ? 'Ya fue enviada a Meta: el nombre y el idioma no se pueden cambiar.' : 'Tiene que coincidir con el texto; si no, Meta la rechaza.'}
            </p>
            <div className="mt-1.5"><FieldErrors messages={errorsFor('officialLanguage')} /></div>
          </div>
        )}
      </div>

      {official && showOfficialName && (
        <div>
          <FieldLabel htmlFor={fieldId('officialName')}>Nombre en Meta</FieldLabel>
          <CountedInput
            id={fieldId('officialName')}
            quiet
            aria-invalid={officialNameErrors.length > 0 || undefined}
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
          <div className="mt-1.5"><FieldErrors messages={officialNameErrors} /></div>
        </div>
      )}

      {official && (
        <fieldset>
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
          {/* «Authentication» ya no se ofrece al crear: exige un formato fijo
              con código de un solo uso que este editor no arma. Una importada
              que ya lo tenga lo conserva. */}
          {form.officialCategory === 'AUTHENTICATION' && (
            <p className="mt-2 text-sm text-fg-muted">Esta plantilla es de código de verificación (Authentication). Si eliges otro tipo, Meta la vuelve a revisar.</p>
          )}
        </fieldset>
      )}
    </EditorSection>
  )
}
