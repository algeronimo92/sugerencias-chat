import { Checkbox } from "../../../../shared/ui/Checkbox";
import { displayName } from "../../../leads/public/chat";
import type { Chat } from "../../../leads/types";
import { ChatItem } from "../ChatItem";

interface Props {
  chat: Chat;
  checked: boolean;
  onToggle: () => void;
  search: string;
  onPreview: () => void;
  onMarkUnread: () => void;
  isMarkingUnread: boolean;
}

/** Fila en modo selección: tocarla la marca en vez de abrir el chat. */
export function SelectableChatRow({ chat, checked, onToggle, search, onPreview, onMarkUnread, isMarkingUnread }: Props) {
  return (
    <div className="flex items-center">
      <span className="flex shrink-0 pl-3">
        <Checkbox
          aria-label={`Seleccionar ${displayName(chat)}`}
          checked={checked}
          onCheckedChange={onToggle}
        />
      </span>
      <div className="min-w-0 flex-1">
        <ChatItem
          hideHint
          chat={chat}
          isSelected={checked}
          isHighlighted={false}
          search={search}
          onClick={onToggle}
          onPreview={onPreview}
          onMarkUnread={onMarkUnread}
          isMarkingUnread={isMarkingUnread}
        />
      </div>
    </div>
  );
}
