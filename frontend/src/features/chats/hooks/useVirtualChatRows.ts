import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { Chat } from "../../leads/types";

const ROW_ESTIMATE_PX = 88;

interface Options {
  chats: Chat[];
  scrollRef: RefObject<HTMLDivElement | null>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  hasNextPageError: boolean;
  onLoadMore: () => Promise<void> | void;
}

/** Filas virtualizadas de la lista de chats, con el ancla de scroll y la
 * carga de la página siguiente al llegar al final. */
export function useVirtualChatRows({
  chats,
  scrollRef,
  hasNextPage,
  isFetchingNextPage,
  hasNextPageError,
  onLoadMore,
}: Options) {
  // Fila extra al final para el loader/error de la página siguiente.
  const rowCount = chats.length + (hasNextPage ? 1 : 0);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    // Clave estable por chat_id (no por índice): si la lista se reordena
    // (llega un mensaje a otro lead), el virtualizador no debe reutilizar
    // la fila de un chat para otro chat distinto que cayó en el mismo índice.
    getItemKey: (index) =>
      index < chats.length ? chats[index].chat_id : `loader-${index}`,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 6,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Ancla de scroll: recuerda qué lead está arriba de la pantalla. Si llega
  // un mensaje a OTRO lead mientras el usuario está adentro de un chat (la
  // lista sigue montada, oculta con visibility:hidden detrás), ese lead
  // puede saltar de posición y reordenar toda la lista. El scrollTop en
  // píxeles no cambia, pero el lead que quedaba ahí sí — así que al volver
  // la lista "se ve" scrolleada aunque nadie tocó el scroll. Con el ancla,
  // si el lead-referencia cambia de posición, reubicamos el scroll para que
  // siga apareciendo donde el usuario lo dejó.
  const anchorChatIdRef = useRef<string | null>(null);
  const prevChatsRef = useRef<Chat[]>(chats);

  // En un layout effect (después del commit y antes de pintar) y no en el
  // render: React puede descartar un render, y las refs quedaban apuntando a
  // una lista que nunca llegó a pantalla.
  useLayoutEffect(() => {
    const prevChats = prevChatsRef.current;
    if (prevChats === chats) return;
    prevChatsRef.current = chats;
    const anchorId = anchorChatIdRef.current;
    if (!anchorId) return;
    const prevIndex = prevChats.findIndex((chat) => chat.chat_id === anchorId);
    const nextIndex = chats.findIndex((chat) => chat.chat_id === anchorId);
    if (prevIndex !== -1 && nextIndex !== -1 && nextIndex !== prevIndex) {
      rowVirtualizer.scrollToIndex(nextIndex, { align: "start" });
    }
  }, [chats, rowVirtualizer]);

  // Mantiene el ancla al día mientras el usuario scrollea. rowVirtualizer no
  // vuelve a renderizar el componente en cada pixel de scroll (con pocos
  // leads todos caben dentro del overscan, así que ni siquiera cambia qué
  // filas están montadas), así que se lee la posición real de las filas en
  // el DOM (data-index) directamente en el evento de scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function updateAnchor() {
      if (!el) return;
      const containerTop = el.getBoundingClientRect().top;
      let bestIndex: number | null = null;
      for (const row of el.querySelectorAll<HTMLElement>("[data-index]")) {
        const index = Number(row.dataset.index);
        if (row.getBoundingClientRect().bottom <= containerTop) continue;
        if (bestIndex === null || index < bestIndex) bestIndex = index;
      }
      if (bestIndex !== null && bestIndex < chats.length) {
        anchorChatIdRef.current = chats[bestIndex].chat_id;
      }
    }
    updateAnchor();
    el.addEventListener("scroll", updateAnchor, { passive: true });
    return () => el.removeEventListener("scroll", updateAnchor);
  }, [chats, rowVirtualizer, scrollRef]);

  // Lock síncrono aparte de isFetchingNextPage: el array de virtualItems
  // cambia de referencia en re-renders muy seguidos (por ejemplo, el propio
  // recálculo interno del virtualizer), y el efecto de abajo puede volver a
  // ejecutarse antes de que isFetchingNextPage llegue a reflejar "true" en
  // el estado de React Query. Sin este ref, eso dispara fetchNextPage()
  // dos veces para la misma página.
  const isLoadingMoreRef = useRef(false);

  function triggerLoadMore() {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    Promise.resolve(onLoadMore()).finally(() => {
      isLoadingMoreRef.current = false;
    });
  }

  // Patrón recomendado por @tanstack/react-virtual para infinite scroll:
  // si la última fila renderizada ya es (o está por llegar a) la fila de
  // carga, pide la próxima página. El guard de hasNextPageError evita que
  // esto reintente solo en loop apenas falla un fetch: isFetchingNextPage
  // vuelve a false al fallar, así que sin el guard este efecto dispararía
  // otro fetchNextPage de inmediato en cada render, sin que el usuario
  // llegue a ver ni usar el botón "Reintentar".
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (
      lastItem.index >= chats.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !hasNextPageError
    ) {
      triggerLoadMore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    virtualItems,
    chats.length,
    hasNextPage,
    isFetchingNextPage,
    hasNextPageError,
    onLoadMore,
  ]);

  return { rowVirtualizer, virtualItems, triggerLoadMore };
}
