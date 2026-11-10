import { Keyboard, Loader2, Search, Settings, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DialogPrimitive, dialogContentPositionClass, dialogOverlayClass } from '../shared/ui/Dialog'
import { useLeadSearch } from '../features/leads/public/useLeadSearch'
import { displayName, displayPhone } from '../features/leads/public/chat'
import { visibleNavItems } from './navigation'

interface Props {
  role: string | undefined
  onOpenSettings?: () => void
}

interface PaletteItem {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

const SEARCH_DEBOUNCE_MS = 200

/** Los atajos que existen, para que se puedan descubrir sin manual. */
const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['Ctrl + K', 'Abrir esta búsqueda'],
  ['Alt + ↓ / Alt + ↑', 'Chat siguiente / anterior de la lista'],
  ['/ en el mensaje', 'Insertar una plantilla por su atajo'],
  ['Mayús + Enter en un chat de la lista', 'Vista rápida sin abrirlo'],
]

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Ctrl+K (Cmd+K en Mac): buscar un lead por nombre, teléfono o mensaje, o
 * saltar a cualquier pantalla, sin pasar por el menú. Llegar a un lead que no
 * está en la lista visible pedía volver a Chats, limpiar filtros y buscar.
 */
export function CommandPalette({ role, onOpenSettings }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [query])

  // El analista no abre chats: buscar leads solo le devolvería un 403.
  const { data: leads = [], isFetching } = useLeadSearch(open && role !== 'analista' ? debounced : '')

  function close() {
    setOpen(false)
    setQuery('')
    setDebounced('')
    setActiveIndex(0)
  }

  const items = useMemo<PaletteItem[]>(() => {
    const term = normalize(query.trim())
    const screens: PaletteItem[] = visibleNavItems(role).map((item) => ({
      id: `nav:${item.path}`,
      label: item.label,
      hint: 'Ir a',
      icon: item.icon,
      run: () => navigate(item.path),
    }))
    if (onOpenSettings) screens.push({ id: 'settings', label: 'Configuración', hint: 'Abrir', icon: Settings, run: onOpenSettings })
    const matchingScreens = term ? screens.filter((item) => normalize(item.label).includes(term)) : screens
    const leadItems: PaletteItem[] = debounced
      ? leads.map((lead) => ({
          id: `lead:${lead.chat_id}`,
          label: displayName(lead),
          hint: displayPhone(lead) || undefined,
          icon: User,
          run: () => navigate(`/chat/${lead.chat_id}`),
        }))
      : []
    return [...leadItems, ...matchingScreens]
  }, [query, debounced, leads, role, navigate, onOpenSettings])

  const active = Math.min(activeIndex, Math.max(items.length - 1, 0))

  function runItem(item: PaletteItem) {
    close()
    item.run()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((active + 1) % Math.max(items.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((active - 1 + items.length) % Math.max(items.length, 1))
    } else if (event.key === 'Enter' && items[active]) {
      event.preventDefault()
      runItem(items[active])
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClass} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={`${dialogContentPositionClass} !top-[15%] !translate-y-0 w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <DialogPrimitive.Title className="sr-only">Buscar leads y pantallas</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-wa-border px-4 dark:border-wa-border-dark">
            <Search className="h-4 w-4 shrink-0 text-wa-muted dark:text-wa-muted-dark" />
            <input
              autoFocus
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
              onKeyDown={handleKeyDown}
              placeholder="Buscar lead por nombre o teléfono, o una pantalla"
              aria-label="Buscar"
              role="combobox"
              aria-expanded
              aria-controls="command-palette-list"
              aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
              className="h-12 w-full bg-transparent text-sm text-wa-text outline-none placeholder:text-wa-muted dark:text-wa-text-dark dark:placeholder:text-wa-muted-dark"
            />
            {isFetching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-wa-muted" />}
          </div>

          <ul id="command-palette-list" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
            {items.map((item, index) => {
              const Icon = item.icon
              return (
                <li
                  key={item.id}
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runItem(item)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                    index === active ? 'bg-wa-primary/10 text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary' : 'text-wa-text dark:text-wa-text-dark'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-[11px] text-wa-muted dark:text-wa-muted-dark">{item.hint}</span>}
                </li>
              )
            })}
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-wa-muted dark:text-wa-muted-dark">
                {isFetching ? 'Buscando…' : 'Sin resultados'}
              </li>
            )}
          </ul>

          <div className="border-t border-wa-border bg-wa-field/50 px-4 py-2.5 dark:border-wa-border-dark dark:bg-wa-field-dark/40">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
              <Keyboard className="h-3.5 w-3.5" /> Atajos
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              {SHORTCUTS.map(([keys, description]) => (
                <div key={keys} className="contents">
                  <dt className="font-mono text-wa-text dark:text-wa-text-dark">{keys}</dt>
                  <dd className="text-wa-muted dark:text-wa-muted-dark">{description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
