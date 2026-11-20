import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Chat, ChatFilters, MessageSearchHit } from '../../leads/types'
import type { ChatQuickFilter } from '../layoutContext'
import { ChatItem } from "./ChatItem";
import { ChatSearchResults } from "./ChatSearchResults";
import { activeFilterCount } from "./chatList/activeFilterCount";
import { AdvancedFiltersPanel } from "./chatList/AdvancedFiltersPanel";
import { ChatListHeader } from "./chatList/ChatListHeader";
import { ChatListEmpty, ChatListSkeleton, LoadMoreRow } from "./chatList/ChatListStates";
import { OfflineBanner } from "./chatList/OfflineBanner";
import { SelectableChatRow } from "./chatList/SelectableChatRow";

interface Props {
  /** El panel de bandejas está a la vista: la lista no repite sus filtros. */
  inboxPanelVisible?: boolean;
  /** Hay panel de bandejas pero está plegado: botón para mostrarlo. */
  onShowInboxes?: () => void;
  /** En el celular: nombre de la bandeja actual, visible en ese botón. */
  inboxLabel?: string;
  /** Estado de la conversación y orden, debajo del buscador. */
  toolbar?: ReactNode;
  /** Barra fija al pie de la lista (acciones del modo selección). */
  footer?: ReactNode;
  /** Modo selección: los chats marcados (null = apagado). Tocar una fila la
   *  marca en vez de abrir el chat. */
  selection?: ReadonlySet<string> | null;
  onToggleSelected?: (chatId: string) => void;
  chats: Chat[];
  isLoading: boolean;
  error: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  /** Lo buscado ya estabilizado y con los filtros que se le aplican: con algo
   * escrito, la lista pasa a ser el resultado en secciones (contactos y
   * mensajes) y `chats` trae solo los contactos. */
  searchTerm: string;
  searchFilters: ChatFilters;
  contactsTotal: number | null;
  onOpenMessage: (hit: MessageSearchHit) => void;
  filter: ChatQuickFilter;
  onFilterChange: (value: ChatQuickFilter) => void;
  unreadCount: number;
  advancedFilters: ChatFilters;
  onAdvancedFiltersChange: (value: ChatFilters) => void;
  onRefresh: () => Promise<void>;
  selectedId: string | null;
  onSelect: (chat: Chat) => void;
  onPreview: (chat: Chat) => void;
  onMarkUnread: (chat: Chat) => void;
  markingUnreadId?: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  hasNextPageError: boolean;
  onLoadMore: () => Promise<void> | void;
  // Muestra un llamado a conectar WhatsApp en el estado vacío (solo admin, y
  // solo cuando la instancia no está vinculada).
  showConnectWhatsapp?: boolean;
  onConnectWhatsapp?: () => void;
}

const ROW_ESTIMATE_PX = 88;
const HIGHLIGHT_DURATION_MS = 2000;

export function ChatList({
  inboxPanelVisible = false,
  onShowInboxes,
  inboxLabel,
  toolbar,
  footer,
  selection = null,
  onToggleSelected,
  chats,
  isLoading,
  error,
  search,
  onSearchChange,
  searchTerm,
  searchFilters,
  contactsTotal,
  onOpenMessage,
  filter,
  onFilterChange,
  unreadCount,
  advancedFilters,
  onAdvancedFiltersChange,
  onRefresh,
  selectedId,
  onSelect,
  onPreview,
  onMarkUnread,
  markingUnreadId = null,
  hasNextPage,
  isFetchingNextPage,
  hasNextPageError,
  onLoadMore,
  showConnectWhatsapp = false,
  onConnectWhatsapp,
}: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeAdvancedFilterCount = activeFilterCount(advancedFilters);

  // Resalta el lead que salta al tope de la lista por un mensaje nuevo en
  // tiempo real, para que no pase desapercibido si el usuario está
  // scrolleado más abajo. Se ignora la primera carga y los cambios de
  // búsqueda (ahí el "tope nuevo" es solo un resultado distinto, no una
  // novedad real).
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const prevTopIdRef = useRef<string | null>(null);
  const topId = chats[0]?.chat_id ?? null;

  useEffect(() => {
    prevTopIdRef.current = null;
    setHighlightedId(null);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [search, filter, advancedFilters]);

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
  }, [chats, rowVirtualizer]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-none border border-wa-border bg-white shadow-sm md:rounded-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <ChatListHeader
        chatCount={chats.length}
        isLoading={isLoading}
        searchTerm={searchTerm}
        search={search}
        onSearchChange={onSearchChange}
        inboxPanelVisible={inboxPanelVisible}
        onShowInboxes={onShowInboxes}
        inboxLabel={inboxLabel}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((value) => !value)}
        activeAdvancedFilterCount={activeAdvancedFilterCount}
        filter={filter}
        onFilterChange={onFilterChange}
        unreadCount={unreadCount}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={onAdvancedFiltersChange}
        onSelect={onSelect}
      >
        {toolbar}
        {showFilters && (
          <AdvancedFiltersPanel
            advancedFilters={advancedFilters}
            onAdvancedFiltersChange={onAdvancedFiltersChange}
            activeAdvancedFilterCount={activeAdvancedFilterCount}
          />
        )}
      </ChatListHeader>

      <OfflineBanner onRefresh={onRefresh} />

      {searchTerm && (
        <ChatSearchResults
          term={searchTerm}
          filters={searchFilters}
          contacts={chats}
          contactsTotal={contactsTotal}
          isLoadingContacts={isLoading}
          contactsError={error}
          hasMoreContacts={hasNextPage}
          isFetchingMoreContacts={isFetchingNextPage}
          onLoadMoreContacts={onLoadMore}
          selectedId={selectedId}
          onSelect={onSelect}
          onPreview={onPreview}
          onMarkUnread={onMarkUnread}
          markingUnreadId={markingUnreadId}
          onOpenMessage={onOpenMessage}
        />
      )}

      {/* List */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto py-1.5 ${searchTerm ? "hidden" : ""}`}>
        {isLoading && <ChatListSkeleton />}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">
            Error al cargar leads.
          </p>
        )}
        {!isLoading && chats.length === 0 && !error && (
          <ChatListEmpty
            search={search}
            filter={filter}
            showConnectWhatsapp={showConnectWhatsapp}
            onConnectWhatsapp={onConnectWhatsapp}
          />
        )}
        {!isLoading && chats.length > 0 && (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= chats.length;
              const chat = !isLoaderRow ? chats[virtualRow.index] : null;

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {chat ? (
                    selection && onToggleSelected ? (
                    <SelectableChatRow
                      chat={chat}
                      checked={selection.has(chat.chat_id)}
                      onToggle={() => onToggleSelected(chat.chat_id)}
                      search={search}
                      onPreview={() => onPreview(chat)}
                      onMarkUnread={() => onMarkUnread(chat)}
                      isMarkingUnread={markingUnreadId === chat.chat_id}
                    />
                    ) : (
                    <ChatItem
                      chat={chat}
                      isSelected={chat.chat_id === selectedId}
                      isHighlighted={chat.chat_id === highlightedId}
                      search={search}
                      onClick={() => onSelect(chat)}
                      onPreview={() => onPreview(chat)}
                      onMarkUnread={() => onMarkUnread(chat)}
                      isMarkingUnread={markingUnreadId === chat.chat_id}
                    />
                    )
                  ) : (
                    <LoadMoreRow
                      isFetchingNextPage={isFetchingNextPage}
                      hasNextPageError={hasNextPageError}
                      onRetry={triggerLoadMore}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}
