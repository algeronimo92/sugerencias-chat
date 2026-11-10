import { Plug } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Props {
  /** Qué hace falta y qué queda sin poder hacerse, en una frase. */
  message: string
  /** Ancla de la página de Integraciones (#whatsapp, #calendario, #voz, #erp). */
  anchor: 'whatsapp' | 'calendario' | 'voz' | 'erp'
  /** Solo un admin puede conectar; a los demás se les dice a quién pedírselo. */
  canConnect: boolean
  tone?: 'info' | 'warning'
  className?: string
}

/**
 * Aviso en línea cuando una acción depende de una integración que no está
 * conectada. La acción sigue a la vista (así se sabe que existe) pero no se
 * intenta: en vez de un error técnico, el camino para conectarla.
 */
export function IntegrationNotice({ message, anchor, canConnect, tone = 'info', className = '' }: Props) {
  const palette = tone === 'warning'
    ? 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200'
    : 'border-wa-border bg-wa-field/60 text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5 ${palette} ${className}`}>
      <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {message}{' '}
        {canConnect
          ? <Link to={`/integraciones#${anchor}`} className="font-semibold underline">Conectar en Integraciones</Link>
          : <span className="text-wa-muted dark:text-wa-muted-dark">Pídele a un administrador que lo conecte en Integraciones.</span>}
      </span>
    </div>
  )
}
