import { useEffect, useRef, useState, type RefObject } from "react";
import type { ChatFilters } from "../../leads/types";
import type { ChatQuickFilter } from "../layoutContext";

const HIGHLIGHT_DURATION_MS = 2000;

interface Options {
  topId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  search: string;
  filter: ChatQuickFilter;
  advancedFilters: ChatFilters;
}

// Resalta el lead que salta al tope de la lista por un mensaje nuevo en
// tiempo real, para que no pase desapercibido si el usuario está
// scrolleado más abajo. Se ignora la primera carga y los cambios de
// búsqueda (ahí el "tope nuevo" es solo un resultado distinto, no una
// novedad real).
// Al cambiar la búsqueda o los filtros, además, la lista vuelve arriba.
export function useTopChatHighlight({ topId, scrollRef, search, filter, advancedFilters }: Options) {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const prevTopIdRef = useRef<string | null>(null);

  useEffect(() => {
    prevTopIdRef.current = null;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [search, filter, advancedFilters, scrollRef]);

  useEffect(() => {
    if (
      prevTopIdRef.current !== null &&
      topId !== null &&
      topId !== prevTopIdRef.current
    ) {
      setHighlightedId(topId);
      const timeout = setTimeout(
        () => setHighlightedId(null),
        HIGHLIGHT_DURATION_MS,
      );
      prevTopIdRef.current = topId;
      return () => clearTimeout(timeout);
    }
    prevTopIdRef.current = topId;
  }, [topId]);

  // El resaltado es siempre del lead que está arriba: si la búsqueda o un
  // filtro cambian el tope, deja de valer sin un efecto que lo borre.
  return highlightedId === topId ? highlightedId : null;
}
