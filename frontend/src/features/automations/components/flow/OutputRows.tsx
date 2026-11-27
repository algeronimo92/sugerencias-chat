import { Handle, Position } from '@xyflow/react'
import { HANDLE_STYLE, type OutputRow } from './flowCanvasEdges'

/** Una fila por salida, cada una con su punto de conexión a la derecha. */
export function OutputRows({ rows, borderClass }: { rows: readonly OutputRow[]; borderClass: string }) {
  return (
    <div className="mt-2 space-y-1">
      {rows.map(row => (
        <div key={row.handle} className={`relative flex items-center gap-1.5 rounded-md border bg-white/70 px-2 py-1.5 text-[9px] font-semibold text-gray-600 dark:border-flow-border-dark dark:bg-flow-row-dark dark:text-gray-200 ${borderClass}`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: row.color }} /><span className="truncate">{row.label || 'Botón sin texto'}</span>
          <Handle type="source" position={Position.Right} id={row.handle} style={{ ...HANDLE_STYLE, background: row.color, right: -18, top: '50%' }} />
        </div>
      ))}
    </div>
  )
}
