import { RefreshCw } from "lucide-react";
import { applyPwaUpdate, usePwaUpdatePending } from "../shared/pwaUpdate";

/**
 * Estado visible en la cabecera mientras hay un build nuevo esperando.
 *
 * El toast se puede descartar; esto no. Sin un indicador fijo, una pestaña
 * abierta todo el día seguía sirviendo el build anterior y nadie lo notaba
 * (incidente del 2026-11-09, worker nuevo en `waiting` tras un despliegue).
 */
export function PwaUpdateChip() {
  const pending = usePwaUpdatePending();
  if (!pending) return null;
  return (
    <button
      type="button"
      onClick={applyPwaUpdate}
      title="Hay una versión nueva. Actualiza para aplicar los cambios."
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-semibold text-accent-deep outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--accent-soft),var(--accent)_12%)] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Versión nueva</span>
      <span className="hidden sm:inline">· Actualizar</span>
    </button>
  );
}
