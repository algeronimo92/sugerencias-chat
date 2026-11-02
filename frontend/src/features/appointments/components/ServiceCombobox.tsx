import { Check, ChevronDown, Loader2, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Input } from '../../../shared/ui/Input'
import { cn } from '../../../shared/utils/cn'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateLeadService, useLeadServices } from '../../catalogs/public/useLeadServices'
import { filterServices, hasExactService } from '../domain/serviceSearch'

type Option = { kind: 'service'; id: number; name: string } | { kind: 'create'; name: string }

interface ServiceComboboxProps {
  id?: string
  /** Nombre del servicio elegido; la cita lo guarda como texto. */
  value: string
  onChange: (name: string) => void
  disabled?: boolean
  className?: string
}

const optionClass = 'flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-sm'

/**
 * Selector con búsqueda sobre el catálogo de servicios del negocio. Lo escrito
 * solo filtra: el valor cambia al elegir un servicio o al crearlo desde aquí,
 * con el mismo endpoint y permisos que la pantalla de Catálogos.
 */
export function ServiceCombobox({ id, value, onChange, disabled, className }: ServiceComboboxProps) {
  const { data: services = [], isLoading } = useLeadServices()
  const createService = useCreateLeadService()
  const listId = useId()
  const optionId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState(value)
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)

  // Mientras no se edita, el campo muestra el valor (también al restaurar un
  // borrador o limpiar el formulario).
  useEffect(() => { if (!editing) setQuery(value) }, [value, editing])

  const typed = query.trim().split(/\s+/).join(' ')
  const filterText = editing ? query : ''
  const options: Option[] = filterServices(services, filterText).map(service => ({ kind: 'service', id: service.id, name: service.name }))
  if (editing && typed && !isLoading && !hasExactService(services, typed)) options.push({ kind: 'create', name: typed })
  const active = open && activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1

  useEffect(() => {
    if (active < 0) return
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  function close() {
    setOpen(false); setEditing(false); setActiveIndex(-1)
  }

  function openList() {
    if (disabled) return
    setOpen(true)
    setActiveIndex(current => current >= 0 ? current : 0)
  }

  function choose(option: Option) {
    setError(null)
    if (option.kind === 'service') { onChange(option.name); close(); return }
    if (createService.isPending) return
    createService.mutate(option.name, {
      onSuccess: created => { onChange(created.name); close(); toast.success('Servicio creado') },
      onError: mutationError => setError(extractErrorMessage(mutationError)),
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { openList(); return }
      if (options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((Math.max(active, step > 0 ? -1 : 0) + step + options.length) % options.length)
    } else if (event.key === 'Enter') {
      // Con la lista abierta, Enter elige; nunca envía el formulario a medias.
      if (!open) return
      event.preventDefault()
      if (active >= 0) choose(options[active])
    } else if (event.key === 'Escape') {
      if (!open && !editing) return
      event.preventDefault()
      close()
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${optionId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          value={query}
          placeholder="Busca o crea un servicio"
          disabled={disabled}
          className={cn('pr-9', className)}
          onChange={event => { setQuery(event.target.value); setEditing(true); setOpen(true); setActiveIndex(0); setError(null) }}
          onFocus={openList}
          onClick={openList}
          onBlur={close}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Servicios del catálogo"
        hidden={!open}
        // Elegir con el mouse no debe quitarle el foco al campo antes del clic.
        onMouseDown={event => event.preventDefault()}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-wa-border bg-white p-1 text-wa-text shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
      >
        {options.map((option, index) => (
          <li
            key={option.kind === 'service' ? option.id : 'create'}
            id={`${optionId}-${index}`}
            role="option"
            aria-selected={option.kind === 'service' && option.name === value}
            onClick={() => choose(option)}
            onMouseMove={() => { if (index !== active) setActiveIndex(index) }}
            className={cn(optionClass, index === active && 'bg-wa-active dark:bg-wa-active-dark', option.kind === 'create' && 'font-medium text-wa-primary-strong dark:text-wa-primary')}
          >
            {option.kind === 'service' ? (
              <>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.name === value && <Check className="h-4 w-4 shrink-0 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />}
              </>
            ) : (
              <>
                {createService.isPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">Crear servicio «{option.name}»</span>
              </>
            )}
          </li>
        ))}
        {options.length === 0 && (
          <li role="presentation" className="px-3 py-2 text-sm text-wa-muted dark:text-wa-muted-dark">
            {isLoading ? 'Cargando servicios…' : 'El catálogo no tiene servicios. Escribe un nombre para crearlo.'}
          </li>
        )}
      </ul>
      {error && <p role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
