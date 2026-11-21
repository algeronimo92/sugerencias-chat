import { lazy, Suspense, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router-dom";
import { readEditField } from "../../../shared/navigation/editFieldLink";
import { toast } from "sonner";
import { useMe } from "../../../shared/auth";
import { can } from '../../../shared/permissions'
import { useLayout, useMediaQuery } from "../../../shared/hooks/useBreakpoint";
import { extractErrorMessage } from "../../../shared/utils/errors";
import { useWhatsappStatus } from "../../platform/public/useWhatsapp";
import { useLayoutContext, type ChatFiltersState, type ChatQuickFilter } from "../layoutContext";
import { useMarkChatRead, useMarkChatUnread } from "../queries";
import { useUnreadCount } from '../../leads/public/queries'
import { useChat, useInfiniteChats } from '../../leads/public/queries'
import type { Chat } from '../../leads/types'
import { useOpenChat } from "../useOpenChat";
import { useChatNavigationShortcuts } from "../hooks/useChatNavigationShortcuts";
import { useChatChange, useChatSuggestions, useEscapeClosesChat, useMarkVisibleChatRead } from "../hooks/useChatWorkspace";
import { ChatList } from "./ChatList";
import { InboxPanel } from "./inbox/InboxPanel";
import { InboxSheet } from "./inbox/InboxSheet";
import { ChatListToolbar } from "./inbox/ChatListToolbar";
import { BulkActionsFooter } from "../../leads/public/BulkActionsFooter";
import { BulkSelectionHeader } from "./inbox/BulkSelectionHeader";
import { useStoredToggle } from "../hooks/useStoredToggle";
import { ConversationPane, LeadPanelSheet, SuggestionsColumn } from "./ChatWorkspaceParts";

// Diálogos que solo se abren a pedido: fuera del bundle inicial.
const ChatPeekDialog = lazy(() => import("./ChatPeekDialog").then(m => ({ default: m.ChatPeekDialog })));

const INBOX_LABELS: Record<ChatQuickFilter, string> = {
  all: "Todas",
  mine: "Mías",
  unassigned: "Sin asignar",
  unread: "No leídos",
};

/** La lista de chats con su búsqueda, sus bandejas y la selección múltiple. */
function useChatListData(chatFilters: ChatFiltersState) {
  const query = useInfiniteChats(chatFilters.debouncedSearch, chatFilters.effectiveFilters, {
    // Con una búsqueda, la lista trae solo los contactos: los mensajes los
    // pide el propio resultado, uno por fila.
    contactsOnly: true,
    order: chatFilters.order,
  });
  const chats = query.data?.pages.flatMap((page) => page.items) ?? [];
  const contactsTotal = query.data?.pages[0]?.total ?? null;

  async function loadMore(): Promise<void> {
    if (query.hasNextPage && !query.isFetchingNextPage) await query.fetchNextPage();
  }

  return { ...query, chats, contactsTotal, loadMore };
}

function toggleInSet(current: Set<string> | null, id: string) {
  const next = new Set(current ?? []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface ListColumnProps {
  chatFilters: ChatFiltersState;
  list: ReturnType<typeof useChatListData>;
  chatId: string | null;
  selectedChatId: string | null;
  isMobile: boolean;
  showInboxes: boolean;
  inboxesCollapsed: boolean;
  toggleInboxes: () => void;
  canAssign: boolean;
  showConnectWhatsapp: boolean;
  onConnectWhatsapp: () => void;
  onSelect: (chat: Chat) => void;
  onPreview: (chat: Chat) => void;
}

/* En móvil la lista ocupa la pantalla entera y se retira al abrir un chat: no
   hay lugar para las dos cosas a la vez. Se oculta con invisible + absolute
   (no display:none): un contenedor con display:none pierde el scroll del todo
   al ocultarse -no hay forma de restaurarlo después, ni con JS-, mientras que
   visibility:hidden conserva el layout y con él la posición de scroll:
   absolute lo saca del flujo para que el chat pueda ocupar el ancho completo. */
function listColumnClass(isMobile: boolean, chatOpen: boolean) {
  if (!isMobile) return "w-72 shrink-0 2xl:w-[324px]";
  return chatOpen ? "invisible pointer-events-none absolute inset-0" : "w-full";
}

function ChatListColumn({ chatFilters, list, chatId, selectedChatId, isMobile, showInboxes, inboxesCollapsed, toggleInboxes, canAssign, showConnectWhatsapp, onConnectWhatsapp, onSelect, onPreview }: ListColumnProps) {
  const navigate = useNavigate();
  const { data: unreadCount = 0 } = useUnreadCount();
  const markChatUnread = useMarkChatUnread();
  // Modo selección de la lista: null = apagado; un Set (aunque vacío) = activo.
  const [selection, setSelection] = useState<Set<string> | null>(null);
  // En el celular las bandejas van en una hoja inferior (doc 18 §6.5).
  const [inboxSheetOpen, setInboxSheetOpen] = useState(false);
  const inboxesShown = showInboxes && !inboxesCollapsed;

  function handleMarkChatUnread(chat: Chat) {
    if (chat.chat_id === chatId) navigate("/");
    markChatUnread.mutate(chat.chat_id, {
      onSuccess: () =>
        toast.success(
          `${chat.name || chat.phone || "Chat"} marcado como no leído`,
        ),
      onError: (error) => toast.error(extractErrorMessage(error)),
    });
  }

  function showInboxesAction() {
    if (isMobile) return () => setInboxSheetOpen(true);
    return showInboxes && inboxesCollapsed ? toggleInboxes : undefined;
  }

  return (
    <>
      {/* Bandejas: desde 1440 px, plegables (decisión 4 del doc 18). Plegado no
          deja columna: se vuelve a mostrar desde la cabecera de la lista. */}
      {inboxesShown && (
        <div className="h-full shrink-0 overflow-hidden rounded-xl">
          <InboxPanel filters={chatFilters} onCollapse={toggleInboxes} />
        </div>
      )}
      {isMobile && (
        <InboxSheet filters={chatFilters} open={inboxSheetOpen} onOpenChange={setInboxSheetOpen} />
      )}
      <div className={`h-full overflow-hidden ${listColumnClass(isMobile, Boolean(chatId))}`}>
        <ChatList
          // En el celular la hoja de bandejas ya trae estos filtros: con
          // ellos arriba quedaban cuatro filas de controles sobre los leads.
          inboxPanelVisible={inboxesShown || isMobile}
          inboxLabel={isMobile ? INBOX_LABELS[chatFilters.chatFilter] : undefined}
          onShowInboxes={showInboxesAction()}
          toolbar={selection ? (
            <BulkSelectionHeader
              selected={selection}
              visibleIds={list.chats.map((chat) => chat.chat_id)}
              onSelectionChange={setSelection}
              onCancel={() => setSelection(null)}
            />
          ) : (
            <ChatListToolbar filters={chatFilters} searching={!!chatFilters.debouncedSearch} onStartSelection={() => setSelection(new Set())} />
          )}
          footer={selection && (
            <BulkActionsFooter selected={selection} onSelectionChange={setSelection} isAdmin={canAssign} />
          )}
          selection={selection}
          onToggleSelected={(id) => setSelection((current) => toggleInSet(current, id))}
          chats={list.chats}
          isLoading={list.isLoading}
          error={!!list.error}
          search={chatFilters.search}
          onSearchChange={chatFilters.setSearch}
          searchTerm={chatFilters.debouncedSearch}
          searchFilters={chatFilters.effectiveFilters}
          contactsTotal={list.contactsTotal}
          onOpenMessage={(hit) =>
            navigate(`/chat/${hit.chat_id}`, { state: { highlightMessageId: hit.message_id } })
          }
          filter={chatFilters.chatFilter}
          onFilterChange={chatFilters.setChatFilter}
          unreadCount={unreadCount}
          advancedFilters={chatFilters.advancedFilters}
          onAdvancedFiltersChange={chatFilters.setAdvancedFilters}
          onRefresh={async () => {
            await list.refetch();
          }}
          selectedId={selectedChatId}
          onSelect={onSelect}
          onPreview={onPreview}
          onMarkUnread={handleMarkChatUnread}
          markingUnreadId={
            markChatUnread.isPending ? markChatUnread.variables : null
          }
          hasNextPage={!!list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          hasNextPageError={list.isFetchNextPageError}
          onLoadMore={list.loadMore}
          showConnectWhatsapp={showConnectWhatsapp}
          onConnectWhatsapp={onConnectWhatsapp}
        />
      </div>
    </>
  );
}

/** 'mobile' = una vista a la vez + navegación inferior; 'tablet' = lista y
 *  conversación, con las sugerencias en un panel deslizable; 'desktop' = las
 *  tres columnas de siempre. Las bandejas se ven desde 1440 px. */
function useWorkspaceLayout() {
  const layout = useLayout();
  const isMobile = layout === "mobile";
  const wide = useMediaQuery("(min-width: 1440px)");
  const [inboxesCollapsed, toggleInboxes] = useStoredToggle("inbox-panel-collapsed");
  return { isMobile, isDesktop: layout === "desktop", showInboxes: wide && !isMobile, inboxesCollapsed, toggleInboxes };
}

function PreviewDialog({ chat, onClose, onOpen }: { chat: Chat | null; onClose: () => void; onOpen: (chat: Chat) => void }) {
  return (
    <Suspense fallback={null}>
      {chat && (
        <ChatPeekDialog
          chat={chat}
          onClose={onClose}
          onOpen={() => {
            onClose();
            onOpen(chat);
          }}
        />
      )}
    </Suspense>
  );
}

export function ChatWorkspace() {
  const { data: me } = useMe();
  // Conectar integraciones (WhatsApp, voz) desde los avisos del chat.
  const isAdmin = can(me, "settings.manage");
  const chatId = useMatch("/chat/:chatId")?.params.chatId ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const handleSelectChat = useOpenChat();
  const { chatFilters, openIntegrations } = useLayoutContext();

  const { isMobile, isDesktop, showInboxes, inboxesCollapsed, toggleInboxes } = useWorkspaceLayout();
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const closeSuggestions = () => setIsSuggestionsOpen(false);
  // Se llegó a cambiar un dato del lead (?editar=…, p. ej. desde Catálogos):
  // fuera de escritorio la ficha vive en el panel deslizable, que arranca
  // cerrado; queda abierto mientras dure ese pedido.
  const isEditingFromLink = readEditField(new URLSearchParams(location.search)) !== null;
  const isLeadPanelOpen = isSuggestionsOpen || isEditingFromLink;
  const [previewChat, setPreviewChat] = useState<Chat | null>(null);
  const list = useChatListData(chatFilters);

  // Estado de la conexión de WhatsApp. Lo ve quien atiende chats (tiene que
  // saber que sus mensajes no salen); conectar es de quien configura.
  const { data: whatsappStatus } = useWhatsappStatus({ enabled: can(me, "conversations.view") });
  const showConnectWhatsapp = isAdmin && whatsappStatus != null && whatsappStatus.state !== "open";

  // Consulta directa por clave primaria, independiente de la búsqueda de la lista.
  const { data: selectedChat = null } = useChat(chatId);
  const selectedChatId = selectedChat?.chat_id ?? null;
  useChatNavigationShortcuts(list.chats, chatId, handleSelectChat);
  const suggestions = useChatSuggestions(selectedChatId);
  const { mutate: markChatRead } = useMarkChatRead();

  function handleCloseChat() {
    navigate("/");
  }

  useMarkVisibleChatRead(chatId, selectedChat, markChatRead);
  useChatChange(chatId, closeSuggestions);
  useEscapeClosesChat({
    selectedChatId,
    isSuggestionsOpen,
    closeSuggestions,
    closeChat: handleCloseChat,
  });

  const highlightMessageId = (location.state as { highlightMessageId?: number } | null)?.highlightMessageId ?? null;
  const showConversation = !isMobile || Boolean(chatId);

  return (
    <>
      <div
        className={`relative flex min-w-0 flex-1 overflow-hidden bg-[#edf2f0] dark:bg-[#081216] ${isMobile ? "" : "gap-2 p-2"}`}
      >
        <ChatListColumn
          chatFilters={chatFilters}
          list={list}
          chatId={chatId}
          selectedChatId={selectedChatId}
          isMobile={isMobile}
          showInboxes={showInboxes}
          inboxesCollapsed={inboxesCollapsed}
          toggleInboxes={toggleInboxes}
          canAssign={can(me, "leads.assign")}
          showConnectWhatsapp={showConnectWhatsapp}
          onConnectWhatsapp={() => openIntegrations("whatsapp")}
          onSelect={handleSelectChat}
          onPreview={setPreviewChat}
        />

        {/* Panel central — Conversación */}
        {showConversation && (
          <div
            className={`h-full min-w-0 flex-1 overflow-hidden bg-white shadow-sm dark:bg-wa-panel-dark ${isMobile ? "" : "rounded-2xl border border-wa-border dark:border-wa-border-dark"}`}
          >
            <ConversationPane
              selectedChat={selectedChat}
              chatId={chatId}
              isMobile={isMobile}
              isDesktop={isDesktop}
              whatsappStatus={whatsappStatus}
              canConnect={isAdmin}
              highlightMessageId={highlightMessageId}
              onClose={handleCloseChat}
              onOpenSuggestions={() => setIsSuggestionsOpen(true)}
            />
          </div>
        )}

        {/* Panel derecho — Sugerencias. Solo en escritorio: por debajo de
          1280px las tres columnas dejarían la conversación inusable, así
          que las sugerencias pasan a un panel deslizable. */}
        {isDesktop && (
          <SuggestionsColumn selectedChat={selectedChat} suggestions={suggestions} canConnect={isAdmin} onUse={closeSuggestions} />
        )}
      </div>

      <PreviewDialog chat={previewChat} onClose={() => setPreviewChat(null)} onOpen={handleSelectChat} />

      <LeadPanelSheet
        chat={!isDesktop && isLeadPanelOpen ? selectedChat : null}
        suggestions={suggestions}
        canConnect={isAdmin}
        onClose={closeSuggestions}
      />
    </>
  );
}
