import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { PAGE_SIZES, type PageSize } from '../hooks/usePageSize'
import { Select } from './Input'

interface PaginationProps {
  page: number
  pageSize: PageSize
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: PageSize) => void
  /** Qué se pagina, en singular y plural: "lead"/"leads", "tarea"/"tareas". */
  noun?: { one: string; many: string }
}

/** Números alrededor de la página actual (`size` como máximo): con listas de
 *  cientos de filas, una fila con todos no entraría. */
function pageWindow(page: number, pageCount: number, size: number): number[] {
  const start = Math.max(0, Math.min(page - Math.floor(size / 2), pageCount - size))
  return Array.from({ length: Math.min(size, pageCount) }, (_, index) => start + index)
}

function PageButton({ label, disabled, current, onClick, children, className = 'flex' }: { label: string; disabled?: boolean; current?: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`${className} h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong disabled:cursor-not-allowed disabled:opacity-40 ${
        current
          ? 'border-wa-primary-strong bg-wa-primary-strong/10 text-wa-primary-strong dark:border-wa-primary dark:bg-wa-primary/15 dark:text-wa-primary'
          : 'border-wa-border text-wa-text hover:bg-wa-hover disabled:hover:bg-transparent dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'
      }`}
    >
      {children}
    </button>
  )
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, noun = { one: 'lead', many: 'leads' } }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)
  const isFirst = page === 0
  const isLast = page >= pageCount - 1
  const compactPages = pageWindow(page, pageCount, 3)

  return (
    // En el celular todo va en una fila (resumen, números, filas por página):
    // en dos filas se comía alto de la lista. Ahí se ven 3 números en vez de 5.
    <nav aria-label={`Paginación de ${noun.many}`} className="flex shrink-0 items-center gap-x-2 border-t border-wa-border bg-wa-panel px-4 py-2 sm:gap-x-4 sm:px-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <p className="shrink-0 text-sm tabular-nums text-wa-muted dark:text-wa-muted-dark" aria-live="polite">
        {first}–{last} de {total}<span className="hidden sm:inline"> {total === 1 ? noun.one : noun.many}</span>
      </p>
      <label className="order-3 flex shrink-0 items-center gap-2 text-sm text-wa-muted sm:order-2 sm:ml-auto dark:text-wa-muted-dark">
        <span className="hidden sm:inline">Filas por página</span>
        <span className="sr-only sm:hidden">Filas por página</span>
        <Select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
          className="h-8 min-h-8 w-auto border-wa-border bg-wa-panel py-0 pr-8 text-sm focus:ring-wa-primary-strong dark:border-wa-border-dark dark:bg-wa-panel-dark"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </Select>
      </label>
      <div className="order-2 ml-auto flex items-center gap-1 sm:order-3 sm:ml-0">
        <PageButton className="hidden sm:flex" label="Primera página" disabled={isFirst} onClick={() => onPageChange(0)}><ChevronsLeft className="h-4 w-4" aria-hidden="true" /></PageButton>
        <PageButton label="Página anterior" disabled={isFirst} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></PageButton>
        {pageWindow(page, pageCount, 5).map((index) => (
          <PageButton
            key={index}
            className={compactPages.includes(index) ? 'flex' : 'hidden sm:flex'}
            label={`Página ${index + 1}`}
            current={index === page}
            onClick={() => onPageChange(index)}
          >
            {index + 1}
          </PageButton>
        ))}
        <PageButton label="Página siguiente" disabled={isLast} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></PageButton>
        <PageButton className="hidden sm:flex" label="Última página" disabled={isLast} onClick={() => onPageChange(pageCount - 1)}><ChevronsRight className="h-4 w-4" aria-hidden="true" /></PageButton>
      </div>
    </nav>
  )
}
