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
      className="ml-1 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-wa-primary/30 bg-wa-primary/10 px-2.5 text-[11px] font-semibold text-wa-primary-strong outline-none transition-colors hover:bg-wa-primary/20 focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:border-wa-primary/40 dark:bg-wa-primary/15 dark:text-wa-primary dark:hover:bg-wa-primary/25"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Versión nueva</span>
      <span className="hidden sm:inline">· Actualizar</span>
    </button>
  );
}
