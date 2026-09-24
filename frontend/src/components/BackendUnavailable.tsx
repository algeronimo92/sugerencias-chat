import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "./ui/Button";

type BackendUnavailableProps = {
  detail?: string;
  isRetrying?: boolean;
  onRetry: () => void | Promise<unknown>;
};

export function BackendUnavailable({
  detail = "No se pudo establecer conexión con el servidor.",
  isRetrying = false,
  onRetry,
}: BackendUnavailableProps) {
  return (
    <main className="flex h-full items-center justify-center bg-wa-app p-4 dark:bg-wa-app-dark">
      <div
        role="alert"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-xl dark:border-red-900 dark:bg-wa-panel-dark"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-wa-text dark:text-wa-text-dark">
          Backend no disponible
        </h1>
        <p className="mt-2 text-sm text-wa-muted dark:text-wa-muted-dark">
          El frontend está funcionando, pero no pudo consultar tu sesión en el servidor.
        </p>
        <p className="mt-3 rounded-lg bg-wa-field px-3 py-2 text-xs text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
          {detail}
        </p>
        <Button
          disabled={isRetrying}
          onClick={() => {
            void onRetry();
          }}
          className="mt-5"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isRetrying ? "Reconectando…" : "Reintentar conexión"}
        </Button>
      </div>
    </main>
  );
}
