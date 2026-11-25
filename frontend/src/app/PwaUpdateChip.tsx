import { RefreshCw } from "lucide-react";
import { applyPwaUpdate, usePwaUpdatePending } from "../shared/pwaUpdate";
import { Tooltip } from "../shared/ui/Tooltip";

const UPDATE_HINT = "Hay una versión nueva. Actualiza para aplicar los cambios.";

/**
 * Estado visible en la cabecera mientras hay un build nuevo esperando.
 *
 * El toast se puede descartar; esto no. Sin un indicador fijo, una pestaña
 * abierta todo el día seguía sirviendo el build anterior y nadie lo notaba
 * (incidente del 2026-11-09, worker nuevo en `waiting` tras un despliegue).
 *
 * `compact` es para el menú lateral: el chip con texto no cabía junto a
 * campana, ayuda y configuración (se salía del menú expandido y se partía en
 * dos líneas en el contraído). Ahí va como ícono del mismo tamaño que los
 * demás, con punto de acento y el texto en el tooltip (a la derecha: arriba
 * se cortaba contra el borde izquierdo de la ventana).
 */
export function PwaUpdateChip({ compact = false }: { compact?: boolean }) {
  const pending = usePwaUpdatePending();
  if (!pending) return null;
  if (compact) {
    return (
      <Tooltip content="Versión nueva · Actualizar" side="right">
        <button
          type="button"
          onClick={applyPwaUpdate}
          aria-label={UPDATE_HINT}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-deep outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--accent-soft),var(--accent)_12%)] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={applyPwaUpdate}
      title={UPDATE_HINT}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-semibold text-accent-deep outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--accent-soft),var(--accent)_12%)] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Versión nueva</span>
      <span className="hidden sm:inline">· Actualizar</span>
    </button>
  );
}
