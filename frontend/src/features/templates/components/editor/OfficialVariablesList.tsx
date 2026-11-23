import { useState } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { Select } from '../../../../shared/ui/Input'
import { APPOINTMENT_SOURCES, LEAD_SOURCES, sampleOf } from '../../domain/officialParameters'
import { singleSource } from '../../domain/officialVariables'
import { OfficialVariablesSection } from '../OfficialVariablesSection'
import { FieldErrors } from './parts'

interface Props {
  id: string
  values: string[]
  onChange: (values: string[]) => void
  errors: string[]
}

/**
 * Qué dato lleva cada variable de una plantilla oficial, justo debajo del
 * texto (2026-11-23). Una fila por variable con un selector y el ejemplo que
 * verá Meta; el armador de piezas, que mezcla datos y texto fijo, queda a un
 * clic para el caso menos común.
 */
export function OfficialVariablesList({ id, values, onChange, errors }: Props) {
  const [combining, setCombining] = useState(() => values.some(value => value.trim() !== '' && singleSource(value) === null))

  // La variable se llama por su número en el texto (`{{1}}`, `{{2}}`…): ese
  // nombre es su identidad, y no cambia aunque cambie el dato que lleva.
  const variables = values.map((value, index) => ({ name: String(index + 1), value }))

  if (values.length === 0) {
    return (
      <p className="rounded-lg bg-subtle px-3 py-2.5 text-sm text-fg-muted">
        Este mensaje todavía no lleva datos que cambien en cada envío. Usa «Insertar dato» para sumar el nombre del cliente o la fecha de su cita.
      </p>
    )
  }

  return (
    <div id={id} tabIndex={-1} className="overflow-hidden rounded-lg border border-line outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-subtle px-3 py-2.5">
        <h3 className="text-sm font-semibold text-fg">Datos que cambian en cada envío</h3>
        <p className="text-xs text-fg-muted">El ejemplo es lo que revisa Meta</p>
      </div>
      {combining ? (
        <div className="border-t border-line p-3">
          <OfficialVariablesSection variables={variables.map(variable => variable.name)} values={values} onChange={onChange} />
        </div>
      ) : variables.map(({ name, value }) => {
        const source = singleSource(value)
        return (
          <div key={name} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2.5">
            <code className="w-11 shrink-0 font-mono text-sm text-fg-muted">{`{{${name}}}`}</code>
            <div className="min-w-0 flex-[1_1_14rem]">
              <Select
                aria-label={`Dato de la variable ${name}`}
                aria-invalid={value.trim() === '' && errors.length > 0 ? true : undefined}
                value={source ?? ''}
                onChange={event => onChange(variables.map(item => item.name === name ? `{{${event.target.value}}}` : item.value))}
              >
                <option value="" disabled>Elige un dato</option>
                <optgroup label="Del lead">
                  {LEAD_SOURCES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </optgroup>
                <optgroup label="De la cita">
                  {APPOINTMENT_SOURCES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                </optgroup>
              </Select>
            </div>
            <p className="min-w-0 flex-[1_1_10rem] text-sm text-fg-muted">
              {value.trim() ? <>Ejemplo: <strong className="font-semibold text-fg">{sampleOf(value)}</strong></> : 'Sin dato elegido'}
            </p>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
        <p className="text-xs text-fg-muted">
          {combining ? 'Arrastra datos a cada variable y mézclalos con texto fijo.' : '¿Un dato con texto fijo, como «Dra.» más el nombre?'}
        </p>
        <Button
          variant="link"
          size="sm"
          // Con una mezcla armada no se vuelve a la lista simple: el selector
          // no podría mostrarla y parecería que se perdió.
          disabled={combining && values.some(item => item.trim() !== '' && singleSource(item) === null)}
          onClick={() => setCombining(current => !current)}
        >
          {combining ? 'Volver a la lista simple' : 'Combinar datos y texto'}
        </Button>
      </div>
      {errors.length > 0 && <div className="border-t border-line px-3 py-2"><FieldErrors messages={errors} /></div>}
    </div>
  )
}
