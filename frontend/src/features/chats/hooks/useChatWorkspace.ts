import { useEffect } from "react";
import { hasOpenOverlay } from "../../../shared/utils/overlay";
import { setPwaCurrentChatId } from "../../../shared/pwaUpdate";
import {
  SuggestionError,
  useGenerateSuggestions,
  useSuggestionStatus,
} from "../../ai/public/useSuggestions";
import type { Chat } from "../../leads/types";

/** Marca el chat como visto solo cuando realmente está visible. Si queda
 *  seleccionado mientras la ventana está en segundo plano, sus mensajes
 *  siguen pendientes hasta que el usuario regrese. */
export function useMarkVisibleChatRead(chatId: string | null, selectedChat: Chat | null, markChatRead: (chatId: string) => void) {
  useEffect(() => {
    function markVisibleChatRead() {
      if (
        chatId &&
        selectedChat &&
        selectedChat.unread_count > 0 &&
        !document.hidden &&
        document.hasFocus()
      ) {
        markChatRead(chatId);
      }
    }

    markVisibleChatRead();
    window.addEventListener("focus", markVisibleChatRead);
    document.addEventListener("visibilitychange", markVisibleChatRead);
    return () => {
      window.removeEventListener("focus", markVisibleChatRead);
      document.removeEventListener("visibilitychange", markVisibleChatRead);
    };
    // selectedChat.timestamp cambia si llega un mensaje al chat abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, selectedChat?.unread_count]);
}

/** Escape cierra el lead abierto, igual que WhatsApp. */
export function useEscapeClosesChat({ selectedChatId, isSuggestionsOpen, closeSuggestions, closeChat }: {
  selectedChatId: string | null;
  isSuggestionsOpen: boolean;
  closeSuggestions: () => void;
  closeChat: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Una pulsación cierra una sola capa, la de más arriba. Con un diálogo
      // encima (la vista previa de una plantilla, el visor de multimedia, un
      // confirmar…) el Escape es de ese diálogo y el lead de atrás no se toca.
      if (hasOpenOverlay()) return;
      // El panel de sugerencias no es un diálogo pero también tapa el chat.
      if (isSuggestionsOpen) {
        closeSuggestions();
        return;
      }
      if (selectedChatId) {
        closeChat();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId, isSuggestionsOpen]);
}

/** Al cambiar de chat: fuera de escritorio las sugerencias son un panel
 *  superpuesto y tienen que cerrarse (o quedarían mostrando el lead
 *  anterior), y el aviso de versión nueva se vuelve a ofrecer; quien lo
 *  muestra vive fuera del router, así que se le cuenta por el store. */
export function useChatChange(chatId: string | null, closeSuggestions: () => void) {
  useEffect(() => {
    closeSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    setPwaCurrentChatId(chatId);
    return () => setPwaCurrentChatId(null);
  }, [chatId]);
}

/**
 * Sugerencias a demanda: al abrir un chat solo se LEE lo ya generado (gratis,
 * sin IA). Generar es siempre una acción explícita del vendedor. Si llega un
 * mensaje nuevo del cliente, useChatUpdates invalida esta query y el refetch
 * apenas marca la sugerencia como desactualizada (stale).
 */
export function useChatSuggestions(chatId: string | null) {
  const { data: status = null, isLoading } = useSuggestionStatus(chatId);

  // Única vía que llama a la IA: CTA "Genera sugerencias" / "Genera otras".
  const generate = useGenerateSuggestions();
  const forThisChat = generate.variables?.chat_id === chatId;
  const error = generate.error && forThisChat ? generate.error : null;

  return {
    data: status?.suggestion ?? null,
    generatedAt: status?.generated_at ?? null,
    isStale: status?.stale ?? false,
    unavailable: status?.unavailable ?? null,
    isLoading,
    isGenerating: generate.isPending && forThisChat,
    error: error?.message ?? null,
    errorRetryable: !(error instanceof SuggestionError) || error.retryable,
    errorCode: error instanceof SuggestionError ? error.code : null,
    generate: (chat: Chat, force = false, instruction?: string) =>
      generate.mutate({ chat_id: chat.chat_id, phone: chat.phone, force, instruction }),
  };
}

export type ChatSuggestions = ReturnType<typeof useChatSuggestions>;
