import { EyeOff } from 'lucide-react'
import { Checkbox } from '../../../../shared/ui/Checkbox'

/**
 * "Visible para vendedores", junto al disparador manual que es lo único a lo
 * que afecta (2026-11-09). Antes estaba en la cabecera, entre los ajustes del
 * borrador, y no se notaba que se guarda al instante ni qué pasaba
 * desmarcado: "Hollywood peel" quedó oculto y los vendedores no lo veían en
 * «Iniciar flujo» sin que nadie lo supiera.
 */
export function SellerVisibilityField({ visible, saved, onChange }: {
  visible: boolean
  /** Sin guardar el borrador todavía no hay flujo al que aplicarlo. */
  saved: boolean
  onChange: (visible: boolean) => void
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 rounded-xl border border-wa-border bg-wa-hover p-3 text-[10px] text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-200">
        <Checkbox checked={visible} disabled={!saved} onChange={event => onChange(event.target.checked)} />
        <span>
          <strong className="block text-xs">Visible para vendedores</strong>
          <span className="mt-0.5 block text-wa-muted dark:text-wa-muted-dark">
            {!saved
              ? 'Guarda el borrador primero.'
              : 'Aparece en «Iniciar flujo» del chat para cualquier vendedor. Se guarda al instante, sin publicar.'}
          </span>
        </span>
      </label>
      {saved && !visible && (
        <p role="status" className="flex items-start gap-1.5 rounded-lg bg-wa-hover px-3 py-2 text-[10px] text-gray-700 dark:bg-white/5 dark:text-gray-200">
          <EyeOff className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Ahora solo los administradores pueden iniciarlo. Márcalo para que los vendedores lo vean en el chat.
        </p>
      )}
    </div>
  )
}
