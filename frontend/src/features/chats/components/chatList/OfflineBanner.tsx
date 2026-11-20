import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useChatSocketConnected } from "../../../../realtime/useRealtime";

// Margen antes de mostrar el aviso de conexión degradada: cubre el parpadeo
// del socket durante el arranque y las reconexiones automáticas (3s de retry).
const OFFLINE_BANNER_DELAY_MS = 5_000;

/** Conexión degradada: el refresh manual solo existe cuando hace falta. */
export function OfflineBanner({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const socketConnected = useChatSocketConnected();
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  // El WebSocket mantiene la lista al día; el refresh manual solo se ofrece
  // cuando la conexión en tiempo real lleva un rato caída (queda el polling
  // de respaldo de 60s, pero el usuario puede no querer esperarlo).
  useEffect(() => {
    if (socketConnected) {
      setShowOfflineBanner(false);
      return;
    }
    const timeout = setTimeout(
      () => setShowOfflineBanner(true),
      OFFLINE_BANNER_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [socketConnected]);

  async function handleRefresh() {
    setIsManualRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsManualRefreshing(false);
    }
  }

  if (!showOfflineBanner) return null;

  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">Sin conexión en tiempo real</span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isManualRefreshing}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-semibold transition-colors hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/40"
      >
        <RefreshCw
          className={`h-3 w-3 ${isManualRefreshing ? "animate-spin" : ""}`}
          aria-hidden="true"
        />
        {isManualRefreshing ? "Actualizando…" : "Actualizar ahora"}
      </button>
    </div>
  );
}
