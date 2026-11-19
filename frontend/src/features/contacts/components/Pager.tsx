import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { cn } from '../../../shared/utils/cn'

interface Props {
  page: number
  pages: number
  onChange: (page: number) => void
  className?: string
}

/** Anterior / siguiente con "Página N de M". No se dibuja con una sola página. */
export function Pager({ page, pages, onChange, className }: Props) {
  if (pages <= 1) return null
  return (
    <nav aria-label="Páginas" className={cn('flex items-center justify-center gap-3 text-sm text-wa-muted dark:text-wa-muted-dark', className)}>
      <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Página anterior">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span>Página {page + 1} de {pages}</span>
      <Button variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label="Página siguiente">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  )
}
