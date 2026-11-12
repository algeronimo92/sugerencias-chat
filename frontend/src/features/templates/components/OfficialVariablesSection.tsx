import { useState } from 'react'
import { parseLine, serializeLine, type PieceDraft } from '../../../shared/pieces'
import { VariablesBuilder, type VariableFieldGroup } from '../../../shared/ui/VariablesBuilder'
import {
  APPOINTMENT_SOURCES,
  LEAD_SOURCES,
  PARAMETER_KEYS,
  PARAMETER_LABELS,
  fromPieceText,
  sampleOf,
  toPieceText,
} from '../domain/officialParameters'

const GROUPS: VariableFieldGroup[] = [
  {
    id: 'lead',
    label: 'Del lead',
    fields: LEAD_SOURCES,
  },
  {
    id: 'cita',
    label: 'De la cita',
    fields: APPOINTMENT_SOURCES,
  },
]

function draftOf(values: string[]): PieceDraft {
  return { title: [], lines: values.map(value => parseLine(toPieceText(value), PARAMETER_KEYS)) }
}

interface Props {
  /** Nombre de cada variable de la plantilla (`1`, `2`… o con nombre). */
  variables: string[]
  values: string[]
  onChange: (values: string[]) => void
}

/** Las variables de una plantilla oficial: qué dato del lead o de la cita
 *  lleva cada una, mezclado con texto libre, y el ejemplo que verá Meta. */
export function OfficialVariablesSection({ variables, values, onChange }: Props) {
  const [draft, setDraft] = useState(() => draftOf(values))

  // El texto de la plantilla manda cuántas variables hay: si cambió, se
  // agregan o quitan filas sin perder las que ya estaban armadas.
  if (draft.lines.length !== values.length) {
    const lines = values.map((value, index) => draft.lines[index] ?? parseLine(toPieceText(value), PARAMETER_KEYS))
    setDraft({ title: [], lines })
  }

  const change = (next: PieceDraft) => {
    setDraft(next)
    onChange(next.lines.map(line => fromPieceText(serializeLine(line))))
  }

  if (values.length === 0) {
    return (
      <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
        Escribe {'{{1}}'}, {'{{2}}'}… en el contenido donde vaya un dato que cambia en cada envío. Luego eliges aquí qué dato lleva cada una.
      </p>
    )
  }

  return (
    <VariablesBuilder
      groups={GROUPS}
      labels={PARAMETER_LABELS}
      variables={variables}
      draft={draft}
      rendered={values.map(value => (value.trim() ? sampleOf(value) : ''))}
      renderedLabel="Ejemplo que revisa Meta"
      onChange={change}
    />
  )
}
