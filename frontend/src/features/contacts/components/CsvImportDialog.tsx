import { FileSpreadsheet, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Select, labelClass } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { MAX_CSV_BYTES, encodeFileContent } from '../api'
import { CSV_FIELD_LABELS } from '../domain/selection'
import { useCreateCsvImport, usePreviewCsv } from '../hooks/useContacts'
import type { CsvColumnMapping, CsvField, CsvPreview } from '../types'

const FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[]

interface Props {
  onClose: () => void
  /** La importación quedó lista para elegir qué parte pasa. */
  onCreated: (batchId: string) => void
}

/** Paso 1 de importar un CSV: subir el archivo y decir qué columna es qué.
 *  Elegir cuántos contactos pasan es el paso siguiente (ImportReviewDialog). */
export function CsvImportDialog({ onClose, onCreated }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const preview = usePreviewCsv()
  const create = useCreateCsvImport()
  const [file, setFile] = useState<{ name: string; data: string } | null>(null)
  const [table, setTable] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<CsvColumnMapping>({})
  const busy = preview.isPending || create.isPending

  async function choose(selected: File | undefined) {
    if (!selected) return
    if (selected.size > MAX_CSV_BYTES) {
      toast.error('El archivo supera los 5 MB', { description: 'Divídelo en partes más chicas.' })
      return
    }
    const data = await encodeFileContent(selected)
    preview.mutate({ fileName: selected.name, dataBase64: data }, {
      onSuccess: result => {
        setFile({ name: selected.name, data })
        setTable(result)
        setMapping(result.mapping)
      },
      onError: err => toast.error('No se pudo leer el archivo', { description: extractErrorMessage(err) }),
    })
  }

  function submit() {
    if (!file) return
    create.mutate({ fileName: file.name, dataBase64: file.data, mapping }, {
      onSuccess: summary => onCreated(summary.id),
      onError: err => toast.error('No se pudo preparar la importación', { description: extractErrorMessage(err) }),
    })
  }

  function setColumn(field: CsvField, value: string) {
    const index = value === '' ? null : Number(value)
    setMapping(current => {
      // Una columna llena un solo campo: si ya estaba usada, se libera.
      const next: CsvColumnMapping = Object.fromEntries(
        FIELDS.map(name => [name, current[name] === index && index !== null ? null : current[name] ?? null]),
      )
      return { ...next, [field]: index }
    })
  }

  return (
    <Modal
      title="Importar contactos desde un CSV"
      description="En Excel: Archivo > Guardar como > CSV UTF-8. Máximo 20.000 filas."
      icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
      size="lg"
      layer="confirm"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={!table || mapping.telefono == null || busy}>
            {create.isPending ? 'Preparando…' : 'Siguiente: elegir cuántos'}
          </Button>
        </>
      )}
    >
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="sr-only"
        onChange={event => { void choose(event.target.files?.[0]); event.target.value = '' }}
      />
      <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy} className="w-full">
        <Upload className="h-4 w-4" aria-hidden="true" />
        {preview.isPending ? 'Leyendo…' : file ? `Cambiar archivo (${file.name})` : 'Elegir archivo CSV'}
      </Button>

      {table && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-wa-muted dark:text-wa-muted-dark">
            {table.total_rows.toLocaleString('es-PE')} filas. Revisa qué columna corresponde a cada dato; el teléfono es obligatorio.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(field => (
              <label key={field} className="block">
                <span className={labelClass}>{CSV_FIELD_LABELS[field]}{field === 'telefono' ? ' *' : ''}</span>
                <Select value={mapping[field] == null ? '' : String(mapping[field])} onChange={event => setColumn(field, event.target.value)}>
                  <option value="">No importar</option>
                  {table.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}
                </Select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-wa-border dark:border-wa-border-dark">
            <table className="min-w-full text-left text-xs">
              <caption className="sr-only">Primeras filas del archivo</caption>
              <thead className="bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
                <tr>{table.headers.map((header, index) => <th key={index} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-wa-border text-wa-text dark:divide-wa-border-dark dark:text-wa-text-dark">
                {table.sample.map((row, rowIndex) => (
                  <tr key={rowIndex}>{table.headers.map((_, index) => <td key={index} className="whitespace-nowrap px-3 py-1.5">{row[index] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
