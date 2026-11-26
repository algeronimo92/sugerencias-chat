import { CircleCheckBig, MessagesSquare, Sparkles, X } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { lazy, Suspense } from "react";
import { IntegrationNotice } from "../../../shared/ui/IntegrationNotice";
import { Button } from "../../../shared/ui/Button";
import { PageLoader } from "../../../shared/ui/PageLoader";
import { Spinner } from "../../../shared/ui/Spinner";
import { useAiUsage } from "../../ai/public/useAiUsage";
import type { Chat } from "../../leads/types";
import type { ChatSuggestions } from "../hooks/useChatWorkspace";
import { ChatThread } from "./ChatThread";

const SuggestionPanel = lazy(() =>
  import("./SuggestionPanel").then((module) => ({
    default: module.SuggestionPanel,
  })),
);

export function ConversationEmptyState() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-white px-8 text-center dark:bg-wa-panel-dark">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.045]"
        aria-hidden="true"
        style={{
          backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="relative flex max-w-md flex-col items-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong ring-1 ring-wa-primary/10 dark:bg-wa-primary/15 dark:text-wa-primary">
          <MessagesSquare
            className="h-7 w-7"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </span>
        <span className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-wa-primary-strong dark:text-wa-primary">
          Centro de conversaciones
        </span>
        <p className="mt-2 max-w-sm text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
          Elige una conversación de la lista para revisar el historial,
          responder mensajes y gestionar su seguimiento.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {["Historial completo", "Notas del equipo", "Seguimiento"].map(
            (label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-wa-border bg-wa-hover/70 px-3 py-1.5 text-[11px] font-medium text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
              >
                <CircleCheckBig
                  className="h-3.5 w-3.5 text-wa-primary"
                  aria-hidden="true"
                />
                {label}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

export function SuggestionsEmptyState() {
  const { data: usage } = useAiUsage();
  // Sin IA en el paquete no se invita a elegir un lead: se dice por qué no
  // hay sugerencias y a qué paquete subir.
  const unavailable = usage && !usage.enabled ? usage.unavailable_reason : null;
  return (
    <div className="flex h-full flex-col bg-white dark:bg-wa-panel-dark">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-wa-border px-5 dark:border-wa-border-dark">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-xs font-bold text-wa-text dark:text-white">
            Copiloto IA
          </span>
          <span className="block text-[10px] text-wa-muted dark:text-wa-muted-dark">
            Sugerencias para cada conversación
          </span>
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-100 bg-violet-50/70 text-violet-500 dark:border-violet-900/50 dark:bg-violet-950/25 dark:text-violet-300">
          <Sparkles className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </span>
        {unavailable ? (
          <p role="status" className="mt-3 max-w-72 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
            {unavailable}
          </p>
        ) : (
          <p className="mt-2 max-w-62.5 text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">
            Selecciona un lead para ver las sugerencias, señales de compra y
            próximos pasos recomendados.
          </p>
        )}
      </div>
    </div>
  );
}

/** El panel de sugerencias, compartido por la columna de escritorio y el
 *  panel deslizable de móvil/tablet. */
export function WorkspaceSuggestionPanel({ chat, suggestions, canConnect, onUse }: {
  chat: Chat;
  suggestions: ChatSuggestions;
  canConnect: boolean;
  onUse: () => void;
}) {
  return (
    <SuggestionPanel
      chat={chat}
      data={suggestions.data}
      generatedAt={suggestions.generatedAt}
      isStale={suggestions.isStale}
      isLoading={suggestions.isLoading}
      isGenerating={suggestions.isGenerating}
      error={suggestions.error}
      errorRetryable={suggestions.errorRetryable}
      errorCode={suggestions.errorCode}
      unavailable={suggestions.unavailable}
      canConnect={canConnect}
      onUse={onUse}
      onGenerate={(force = false, instruction) => suggestions.generate(chat, force, instruction)}
    />
  );
}

type WhatsappState = { state: string } | null | undefined;

/** Aviso sobre el hilo cuando WhatsApp no está conectado: quien escribe tiene
 *  que saber que su mensaje no sale. */
function WhatsappNotice({ status, canConnect }: { status: WhatsappState; canConnect: boolean }) {
  if (status == null || status.state === "open") return null;
  return (
    <IntegrationNotice
      className="m-2 mb-0"
      tone="warning"
      message={
        status.state === "disconnected"
          ? "WhatsApp se desconectó: los mensajes no salen ni llegan hasta volver a conectarlo."
          : "WhatsApp no está conectado: lo que escribas acá no se enviará al cliente."
      }
      anchor="whatsapp"
      canConnect={canConnect}
    />
  );
}

/** Panel central: el hilo del lead elegido, la espera mientras llega o el
 *  estado vacío. */
export function ConversationPane({ selectedChat, chatId, isMobile, isDesktop, whatsappStatus, canConnect, highlightMessageId, onClose, onOpenSuggestions }: {
  selectedChat: Chat | null;
  chatId: string | null;
  isMobile: boolean;
  isDesktop: boolean;
  whatsappStatus: WhatsappState;
  canConnect: boolean;
  highlightMessageId: number | null;
  onClose: () => void;
  onOpenSuggestions: () => void;
}) {
  if (selectedChat) {
    return (
      <div className="flex h-full flex-col">
        <WhatsappNotice status={whatsappStatus} canConnect={canConnect} />
        <div className="min-h-0 flex-1">
          <ChatThread
            chat={selectedChat}
            highlightMessageId={highlightMessageId}
            onBack={isMobile ? onClose : undefined}
            onOpenSuggestions={isDesktop ? undefined : onOpenSuggestions}
          />
        </div>
      </div>
    );
  }
  if (chatId) {
    /* El lead todavía no llegó (entrada directa por URL o recarga). En móvil
       la lista está oculta, así que sin esta rama la pantalla quedaría sin
       salida. */
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-wa-app dark:bg-wa-panel-dark">
        <Spinner label="Abriendo la conversación…" />
        {isMobile && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Volver a la lista
          </Button>
        )}
      </div>
    );
  }
  return <ConversationEmptyState />;
}

/** Panel derecho de escritorio: las sugerencias del lead o su estado vacío. */
export function SuggestionsColumn({ selectedChat, suggestions, canConnect, onUse }: {
  selectedChat: Chat | null;
  suggestions: ChatSuggestions;
  canConnect: boolean;
  onUse: () => void;
}) {
  return (
    <div className="h-full w-80 shrink-0 overflow-hidden rounded-2xl border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark 2xl:w-[340px]">
      {selectedChat ? (
        // Suspense propio: sin él, la primera carga del chunk suspende
        // hasta el boundary de MainLayout y tapa lista y conversación.
        <Suspense fallback={<PageLoader />}>
          <WorkspaceSuggestionPanel chat={selectedChat} suggestions={suggestions} canConnect={canConnect} onUse={onUse} />
        </Suspense>
      ) : (
        <SuggestionsEmptyState />
      )}
    </div>
  );
}

/** Sugerencias como panel deslizable en móvil y tablet. */
export function LeadPanelSheet({ chat, suggestions, canConnect, onClose }: {
  chat: Chat | null;
  suggestions: ChatSuggestions;
  canConnect: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {chat && (
        <>
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            /* aria-hidden y sin handler de teclado a propósito: un fondo de
               modal no debe ser un punto de tabulación más. Quien navega con
               teclado cierra con Escape (ver useEscapeClosesChat). */
            aria-hidden="true"
            className="fixed inset-0 z-75 bg-black/40"
          />
          <m.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            aria-label="Ficha del lead"
            className="fixed inset-y-0 right-0 z-76 flex w-full max-w-md flex-col overflow-hidden border-l border-wa-border bg-wa-app pt-safe dark:border-wa-border-dark dark:bg-wa-panel-dark"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-wa-border px-3 dark:border-wa-border-dark">
              <span className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                Ficha del lead
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ficha del lead"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-wa-muted hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<PageLoader />}>
                <WorkspaceSuggestionPanel chat={chat} suggestions={suggestions} canConnect={canConnect} onUse={onClose} />
              </Suspense>
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
