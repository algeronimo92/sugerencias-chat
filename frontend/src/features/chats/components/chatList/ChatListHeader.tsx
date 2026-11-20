import { PanelLeftOpen, Search, SlidersHorizontal, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import type { Chat, ChatFilters } from "../../../leads/types";
import type { ChatQuickFilter } from "../../layoutContext";
import { ChatViewChips } from "../ChatViewChips";
import { NewLeadButton } from "./NewLeadButton";

// Pura y sin estado: vive en ámbito de módulo para no reconstruirse en cada
// render, lo que además rompía la memoización de los hijos.
// En el celular 36 px de alto: con py-1.5 medían 28 y se erraba el toque.
const segmentClass = (active: boolean) =>
  `flex-1 whitespace-nowrap rounded-md px-2 py-2 text-xs font-semibold outline-none md:py-1.5 transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-wa-primary/50 ${
    active
      ? "bg-white text-wa-primary-strong shadow-sm ring-1 ring-black/[0.03] dark:bg-wa-active-dark dark:text-wa-primary dark:ring-white/[0.04]"
      : "text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark"
  }`;

interface Props {
  /** Total de filas cargadas; se oculta mientras carga o con una búsqueda. */
  chatCount: number;
  isLoading: boolean;
  searchTerm: string;
  search: string;
  onSearchChange: (value: string) => void;
  inboxPanelVisible: boolean;
  onShowInboxes?: () => void;
  inboxLabel?: string;
  showFilters: boolean;
  onToggleFilters: () => void;
  activeAdvancedFilterCount: number;
  filter: ChatQuickFilter;
  onFilterChange: (value: ChatQuickFilter) => void;
  unreadCount: number;
  advancedFilters: ChatFilters;
  onAdvancedFiltersChange: (value: ChatFilters) => void;
  onSelect: (chat: Chat) => void;
  /** Lo que va debajo del buscador y los filtros rápidos: la barra de estado
   * y orden, y el panel de filtros avanzados. */
  children?: ReactNode;
}

/** Cabecera de la lista de chats: título, nuevo lead, buscador, acceso a las
 * bandejas y a los filtros, y los filtros rápidos cuando no hay panel. */
export function ChatListHeader({
  chatCount,
  isLoading,
  searchTerm,
  search,
  onSearchChange,
  inboxPanelVisible,
  onShowInboxes,
  inboxLabel,
  showFilters,
  onToggleFilters,
  activeAdvancedFilterCount,
  filter,
  onFilterChange,
  unreadCount,
  advancedFilters,
  onAdvancedFiltersChange,
  onSelect,
  children,
}: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border-b border-wa-border px-3 pb-2.5 pt-3 dark:border-wa-border-dark">
      {/* Cabecera compacta: la lista es lo que importa, no el encabezado. */}
      <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {onShowInboxes && !inboxLabel && (
            <Tooltip content="Mostrar bandejas">
              <button
                type="button"
                onClick={onShowInboxes}
                aria-label="Mostrar bandejas"
                className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PanelLeftOpen className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
          <h1 className="truncate text-base font-bold tracking-[-0.02em] text-wa-text dark:text-white">
            Conversaciones
          </h1>
          {/* Con una búsqueda, los totales van en cada sección del
              resultado: acá este número eran las filas cargadas ("30") y
              se leía como el total de resultados. */}
          {!isLoading && !searchTerm && (
            <span className="rounded-full bg-wa-field px-2 py-0.5 text-[10px] font-bold text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
              {chatCount}
            </span>
          )}
        </div>
        <NewLeadButton onOpen={onSelect} />
      </div>
      {/* Búsqueda y filtros avanzados en una sola fila */}
      <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Buscar nombre, teléfono o mensaje"
          aria-label="Buscar nombre, teléfono o mensaje"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 w-full rounded-lg border border-wa-border bg-wa-field/70 pl-9 pr-9 text-sm text-wa-text outline-none transition-[color,background-color,border-color,box-shadow] placeholder:text-wa-muted focus:border-wa-primary/50 focus:bg-white focus:ring-4 focus:ring-wa-primary/10 dark:border-wa-border-dark dark:bg-wa-field-dark/70 dark:text-wa-text-dark dark:placeholder:text-wa-muted-dark dark:focus:border-wa-primary/50 dark:focus:bg-wa-field-dark"
        />
        {/* Vaciar la búsqueda: en el teléfono borrar a mano lo escrito es
            incómodo y el teclado tapa media pantalla. Solo aparece con algo
            escrito, así el buscador vacío queda igual que antes. */}
        {search && (
          <button
            type="button"
            onClick={() => {
              onSearchChange("");
              searchInputRef.current?.focus();
            }}
            aria-label="Borrar búsqueda"
            title="Borrar búsqueda"
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {onShowInboxes && inboxLabel && (
        // Celular: las bandejas se abren desde un icono junto al buscador.
        <Tooltip content={`Bandeja: ${inboxLabel}`}>
          <button
            type="button"
            onClick={onShowInboxes}
            aria-label={`Bandeja: ${inboxLabel}. Cambiar de bandeja`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-control text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelLeftOpen className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      {/* Filtros avanzados: ocultos en el celular por ahora, a pedido
          (2026-11-19); su lugar lo toma el icono de bandejas. El código y
          el panel siguen: solo no se muestra el botón. */}
      {!inboxLabel && (
      <button
        type="button"
        onClick={onToggleFilters}
        aria-label="Filtros avanzados"
        aria-expanded={showFilters}
        title="Filtros avanzados"
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/50 ${
          showFilters || activeAdvancedFilterCount > 0
            ? "border-wa-primary/40 bg-wa-primary/10 text-wa-primary-strong dark:border-wa-primary/40 dark:bg-wa-primary/15 dark:text-wa-primary"
            : "border-wa-border text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {activeAdvancedFilterCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-wa-primary px-1 text-[10px] font-semibold leading-4 text-white">
            {activeAdvancedFilterCount}
          </span>
        )}
      </button>
      )}
      </div>
      {/* Con el panel de bandejas a la vista, estos filtros y las vistas
          rápidas lo repetían: viven en el panel (doc 18 §6.3). */}
      {!inboxPanelVisible && (<>
      <div
        className="mt-2 flex rounded-lg bg-wa-field p-0.5 dark:bg-wa-field-dark"
        role="group"
        aria-label="Filtrar leads"
      >
        <button
          type="button"
          onClick={() => onFilterChange("all")}
          aria-pressed={filter === "all"}
          className={segmentClass(filter === "all")}
        >
          Todos
        </button>
        <button
          type="button"
          onClick={() => onFilterChange("unread")}
          aria-pressed={filter === "unread"}
          className={`flex items-center justify-center gap-1.5 ${segmentClass(filter === "unread")}`}
        >
          No leídos
          {unreadCount > 0 && (
            <span className="min-w-4 rounded-full bg-wa-primary px-1 text-[10px] font-semibold leading-4 text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onFilterChange("mine")}
          aria-pressed={filter === "mine"}
          className={segmentClass(filter === "mine")}
        >
          Mis leads
        </button>
      </div>
      <ChatViewChips
        filters={advancedFilters}
        onChange={onAdvancedFiltersChange}
        canSave={activeAdvancedFilterCount > 0}
      />
      </>)}
      {children}
    </div>
  );
}
