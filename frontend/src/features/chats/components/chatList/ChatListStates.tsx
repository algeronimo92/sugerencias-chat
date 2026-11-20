import { AlertCircle, Loader2, MessagesSquare, Smartphone } from "lucide-react";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { Skeleton } from "../../../../shared/ui/Skeleton";
import type { ChatQuickFilter } from "../../layoutContext";

export function ChatListSkeleton() {
  return (
    <div aria-label="Cargando leads" className="px-3 py-2 space-y-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatListEmpty({
  search,
  filter,
  showConnectWhatsapp,
  onConnectWhatsapp,
}: {
  search: string;
  filter: ChatQuickFilter;
  showConnectWhatsapp: boolean;
  onConnectWhatsapp?: () => void;
}) {
  return (
    <div className="py-4">
      <EmptyState
        icon={MessagesSquare}
        title={
          search
            ? "Sin resultados."
            : filter === "unread"
              ? "No hay chats sin leer."
              : filter === "mine"
                ? "No tienes leads asignados."
                : "Sin leads todavía."
        }
      />
      {showConnectWhatsapp && filter === "all" && !search && (
        <div className="mx-4 mt-2 rounded-xl border border-wa-primary/30 bg-wa-primary/10 p-4 text-left dark:border-wa-primary/30 dark:bg-wa-primary/15">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wa-primary-strong dark:text-wa-primary">
            <Smartphone className="h-4 w-4" /> Conecta tu WhatsApp
          </div>
          <p className="mb-3 text-xs text-wa-primary-strong/80 dark:text-wa-primary/80">
            Vincula el número del negocio con Meta para empezar a recibir
            mensajes.
          </p>
          <button
            type="button"
            onClick={onConnectWhatsapp}
            className="rounded-lg bg-wa-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-wa-primary-strong"
          >
            Conectar WhatsApp
          </button>
        </div>
      )}
    </div>
  );
}

export function LoadMoreRow({
  isFetchingNextPage,
  hasNextPageError,
  onRetry,
}: {
  isFetchingNextPage: boolean;
  hasNextPageError: boolean;
  onRetry: () => void;
}) {
  if (hasNextPageError) {
    return (
      <div className="py-3 flex items-center justify-center gap-2 text-xs text-red-500 dark:text-red-400">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Error al cargar más leads.</span>
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline hover:no-underline text-red-600 dark:text-red-400"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="py-4 flex items-center justify-center">
      {isFetchingNextPage && (
        <Loader2 className="w-4 h-4 text-wa-muted/60 dark:text-wa-muted-dark/60 animate-spin" />
      )}
    </div>
  );
}
