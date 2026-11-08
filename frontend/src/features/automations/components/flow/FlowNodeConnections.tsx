import { ArrowLeft, ArrowRight, X } from 'lucide-react'

export interface FlowConnection {
  edgeId: string
  nodeId: string
  number: number | undefined
  title: string
  /** Por qué salida del bloque de origen pasa ("Siguiente", "Sí", "Salida 2"…). */
  handle: string
}

/**
 * De qué bloques se llega al elegido y a cuáles sigue, con su número: tocar
 * uno lo elige y acerca la vista. Antes solo se listaba la salida, sin número,
 * y para saber de dónde venía un bloque había que seguir la línea a ojo en un
 * lienzo de 50 bloques.
 */
export function FlowNodeConnections({ incoming, outgoing, onGo, onRemove }: {
  incoming: FlowConnection[]
  outgoing: FlowConnection[]
  onGo: (nodeId: string) => void
  onRemove: (edgeId: string) => void
}) {
  return (
    <div className="mt-5 space-y-4 border-t border-wa-border pt-4 dark:border-wa-border-dark">
      <ConnectionList title="Llega desde" empty="Ningún bloque conecta con este." icon="in" items={incoming} onGo={onGo} onRemove={onRemove} />
      <ConnectionList title="Sale hacia" empty="Sin conexiones." icon="out" items={outgoing} onGo={onGo} onRemove={onRemove} />
    </div>
  )
}

function ConnectionList({ title, empty, icon, items, onGo, onRemove }: {
  title: string
  empty: string
  icon: 'in' | 'out'
  items: FlowConnection[]
  onGo: (nodeId: string) => void
  onRemove: (edgeId: string) => void
}) {
  const Icon = icon === 'in' ? ArrowLeft : ArrowRight
  return (
    <section aria-label={title}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-wa-muted">{title}</p>
      {items.length === 0 ? <p className="text-[10px] text-wa-muted">{empty}</p> : items.map(item => (
        <div key={item.edgeId} className="mb-1 flex items-center gap-1 rounded-lg bg-wa-hover text-[10px] dark:bg-wa-head-dark">
          <button
            type="button"
            onClick={() => onGo(item.nodeId)}
            title="Ir a este bloque"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-wa-primary/10"
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
            {item.number != null && <span className="shrink-0 font-bold tabular-nums">#{item.number}</span>}
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="shrink-0 text-wa-muted">{item.handle}</span>
          </button>
          <button type="button" onClick={() => onRemove(item.edgeId)} aria-label={`Quitar la conexión con el bloque ${item.number ?? ''}`} className="px-2 text-red-500">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </section>
  )
}
