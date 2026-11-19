import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input } from '../../../shared/ui/Input'
import { IMPORT_ROWS_PAGE_SIZE } from '../api'
import { formatPhone } from '../domain/selection'
import { useImportRows } from '../hooks/useContacts'
import type { ImportRowStatus } from '../types'

interface Props {
  batchId: string
  status: ImportRowStatus
  /** Sin selección (solo mirar): las filas inválidas, por ejemplo. */
  selected?: number[]
  onChange?: (ids: number[]) => void
}

function lastChat(value: string | null) {
  return value ? new Date(value).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }) : null
}

/** Las filas de una importación, paginadas y con buscador. */
export function ImportRowsPicker({ batchId, status, selected, onChange }: Props) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading } = useImportRows(batchId, status, search, page)
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / IMPORT_ROWS_PAGE_SIZE))
  const chosen = new Set(selected ?? [])
  const pageAllChosen = rows.length > 0 && rows.every(row => chosen.has(row.id))

  function toggle(id: number) {
    if (!onChange) return
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  function togglePage() {
    if (!onChange) return
    const next = new Set(chosen)
    for (const row of rows) {
      if (pageAllChosen) next.delete(row.id)
      else next.add(row.id)
    }
    onChange([...next])
  }

  return (
    <div className="rounded-lg border border-wa-border dark:border-wa-border-dark">
      <div className="flex items-center gap-2 border-b border-wa-border p-2 dark:border-wa-border-dark">
        {onChange && <Checkbox checked={pageAllChosen} onCheckedChange={togglePage} aria-label="Marcar toda la página" />}
        <span className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={event => { setSearch(event.target.value); setPage(0) }}
            placeholder="Buscar por nombre o número"
            aria-label="Buscar en la importación"
            className="h-8 pl-8 text-xs"
          />
        </span>
      </div>
      <ul className="max-h-72 divide-y divide-wa-border overflow-y-auto dark:divide-wa-border-dark" aria-busy={isLoading}>
        {isLoading && <li className="p-3 text-xs text-wa-muted dark:text-wa-muted-dark">Cargando…</li>}
        {!isLoading && rows.length === 0 && <li className="p-3 text-xs text-wa-muted dark:text-wa-muted-dark">Nada que mostrar.</li>}
        {rows.map(row => (
          <li key={row.id}>
            <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
              {onChange && <Checkbox checked={chosen.has(row.id)} onCheckedChange={() => toggle(row.id)} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-wa-text dark:text-wa-text-dark">
                  {row.nombre || formatPhone(row.telefono) || 'Sin nombre'}
                </span>
                <span className="block truncate text-wa-muted dark:text-wa-muted-dark">
                  {row.row_number ? `Fila ${row.row_number} · ` : ''}
                  {formatPhone(row.telefono) || 'Sin número'}
                  {row.error ? ` · ${row.error}` : ''}
                </span>
              </span>
              {row.exists && <Badge variant="info" size="md">Ya en la agenda</Badge>}
              {lastChat(row.ultima_interaccion_at) && (
                <span className="shrink-0 text-wa-muted dark:text-wa-muted-dark">{lastChat(row.ultima_interaccion_at)}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-wa-border px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <span>Página {page + 1} de {pages}</span>
          <Button variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}
