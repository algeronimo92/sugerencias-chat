import { Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { searchFlowNodes, type FlowNodeSearchItem } from '../../domain/flowNodeSearch'

/**
 * "Buscar bloque" sobre el lienzo: por número (12, #12) o por lo que dice el
 * bloque. Elegir un resultado lo selecciona y acerca la vista hasta él. Con 50
 * bloques el número solo no alcanzaba: había que recorrer el lienzo a ojo.
 */
export function FlowNodeSearch({ items, onGo }: { items: FlowNodeSearchItem[]; onGo: (nodeId: string) => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => searchFlowNodes(items, query), [items, query])
  const listId = useId()
  const open = query.trim() !== ''

  function go(item: FlowNodeSearchItem) {
    onGo(item.id)
    setQuery('')
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setQuery(''); return }
    if (!results.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % results.length) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + results.length) % results.length) }
    if (event.key === 'Enter') { event.preventDefault(); go(results[Math.min(active, results.length - 1)]) }
  }

  return (
    <div className="absolute left-3 top-3 z-10 w-72">
      <div className="flex items-center gap-2 rounded-lg border border-wa-border bg-white px-2.5 shadow-sm focus-within:border-wa-primary dark:border-flow-border-dark dark:bg-flow-panel-dark">
        <Search className="h-3.5 w-3.5 shrink-0 text-wa-muted" aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Buscar bloque por número o texto"
          aria-activedescendant={open && results.length ? `${listId}-${Math.min(active, results.length - 1)}` : undefined}
          value={query}
          onChange={event => { setQuery(event.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          placeholder="Buscar bloque: 12 o texto…"
          className="min-w-0 flex-1 bg-transparent py-2 text-xs text-wa-text outline-none placeholder:text-wa-muted dark:text-white"
        />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda" className="text-wa-muted hover:text-wa-text"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label="Bloques encontrados" className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-wa-border bg-white p-1 shadow-xl dark:border-flow-border-dark dark:bg-flow-panel-dark">
          {results.length === 0 && <li className="px-2 py-2 text-[11px] text-wa-muted">Ningún bloque coincide.</li>}
          {results.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={event => { event.preventDefault(); go(item) }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${index === active ? 'bg-wa-primary/10 dark:bg-white/10' : ''}`}
            >
              <span className="shrink-0 font-bold tabular-nums text-wa-text dark:text-white">#{item.number}</span>
              <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{item.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
