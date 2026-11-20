import type { ReactNode } from "react";
import { useRef, useState } from "react";
import type { Chat, ChatFilters, MessageSearchHit } from '../../leads/types'
import { useTopChatHighlight } from '../hooks/useTopChatHighlight'
import { useVirtualChatRows } from '../hooks/useVirtualChatRows'
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

  const highlightedId = useTopChatHighlight({
    topId: chats[0]?.chat_id ?? null,
    scrollRef,
    search,
    filter,
    advancedFilters,
  });
  const { rowVirtualizer, virtualItems, triggerLoadMore } = useVirtualChatRows({
    chats,
    scrollRef,
    hasNextPage,
    isFetchingNextPage,
    hasNextPageError,
    onLoadMore,
  });

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
