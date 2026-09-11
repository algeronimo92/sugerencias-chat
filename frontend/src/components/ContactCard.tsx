import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Loader2, MessageCircle, X } from "lucide-react";

import type { LeadUpdateInput } from "../types";
import type { SharedContact } from "../utils/message";
import { useCreateLead, useFindLeadByPhone } from "../hooks/useChats";
import { extractErrorMessage } from "../utils/errors";
import { LeadFormDialog } from "./LeadFormDialog";
import {
  DialogPrimitive as Dialog,
  dialogContentPositionClass,
  dialogOverlayClass,
} from "./ui/Dialog";

/** Tarjeta de un contacto compartido, con las mismas acciones que WhatsApp:
 * abrir la conversación con ese número (creándole el lead si todavía no lo
 * tiene) y copiar el teléfono. Un contacto puede traer varios números — con
 * uno solo el botón abre el chat directo, con más de uno primero hay que
 * elegir cuál. */
export function ContactCard({ contacts }: { contacts: SharedContact[] }) {
  return (
    <div className="flex flex-col gap-1">
      {contacts.map((contact, index) => (
        <ContactEntry key={index} contact={contact} />
      ))}
    </div>
  );
}

function formatPhone(digits: string) {
  return `+${digits}`;
}

function ContactEntry({ contact }: { contact: SharedContact }) {
  const navigate = useNavigate();
  const findLeadByPhone = useFindLeadByPhone();
  const { mutate: createLead, isPending: isCreatingLead } = useCreateLead();
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const name = contact.name || "Contacto";
  // El parseo del payload de Meta puede dejar entradas vacías si el contacto
  // trae un teléfono sin número; se descartan acá para que "cuántos números
  // tiene" sea siempre exacto.
  const phones = (contact.phone ?? []).filter((phone): phone is string => !!phone);

  async function handleOpenChat(phone: string) {
    if (isSearching) return;
    setError(null);
    setSelectedPhone(phone);
    setIsSearching(true);
    try {
      const existing = await findLeadByPhone(phone);
      if (existing) navigate(`/chat/${existing.chat_id}`);
      // Sin lead todavía: se abre el alta con el nombre y el número ya
      // cargados, para no crear nada a espaldas del vendedor y para que el
      // formulario haga su verificación de WhatsApp.
      else setIsCreating(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSearching(false);
    }
  }

  function handleSendClick() {
    if (isSearching || phones.length === 0) return;
    if (phones.length === 1) {
      void handleOpenChat(phones[0]);
      return;
    }
    setError(null);
    setIsPicking(true);
  }

  function handlePickPhone(phone: string) {
    setIsPicking(false);
    void handleOpenChat(phone);
  }

  function handleCreateLead(values: LeadUpdateInput) {
    if (isCreatingLead) return;
    setError(null);
    createLead(
      {
        phone: values.phone ?? "",
        name: values.name ?? "",
        servicio_interes: values.servicio_interes,
        vendedor_id: values.vendedor_id,
        origen: values.origen,
        notas: values.notas,
      },
      {
        onSuccess: (chat) => {
          setIsCreating(false);
          navigate(`/chat/${chat.chat_id}`);
        },
        onError: (err) => setError(extractErrorMessage(err)),
      },
    );
  }

  async function handleCopy(phone: string) {
    await navigator.clipboard.writeText(formatPhone(phone));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isBusy = isSearching || isCreatingLead;

  return (
    <div className="overflow-hidden rounded-lg bg-black/5 dark:bg-white/10">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wa-primary/20 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium not-italic text-wa-text dark:text-wa-text-dark">
            {name}
          </p>
          {phones.length > 0 && (
            <p className="truncate text-[11px] not-italic text-wa-muted dark:text-wa-text-dark/60">
              {phones.map(formatPhone).join(" · ")}
            </p>
          )}
        </div>
        {/* Con un solo número no hay ambigüedad: se copia directo desde acá.
            Con varios, cada uno se copia desde el selector. */}
        {phones.length === 1 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleCopy(phones[0]);
            }}
            aria-label={copied ? "Número copiado" : "Copiar número"}
            title={copied ? "Copiado" : "Copiar número"}
            className="shrink-0 rounded-md p-1.5 text-wa-muted transition-colors hover:bg-black/10 hover:text-wa-text dark:text-wa-text-dark/60 dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
          >
            {copied ? (
              <Check aria-hidden="true" className="h-4 w-4 text-wa-primary" />
            ) : (
              <Copy aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {phones.length === 0 ? (
        <p className="border-t border-black/10 px-3 py-1.5 text-[11px] not-italic text-wa-muted dark:border-white/15 dark:text-wa-text-dark/60">
          No llegó el número de este contacto
        </p>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleSendClick();
          }}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-1.5 border-t border-black/10 py-1.5 text-xs font-semibold not-italic text-wa-primary-strong transition-colors hover:bg-black/5 disabled:opacity-60 dark:border-white/15 dark:text-wa-primary dark:hover:bg-white/10"
        >
          {isBusy ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          Enviar mensaje
        </button>
      )}

      {error && (
        <p className="border-t border-black/10 px-3 py-1.5 text-[11px] not-italic text-red-600 dark:border-white/15 dark:text-red-400">
          {error}
        </p>
      )}

      {isPicking && (
        <PhonePickerDialog
          name={name}
          phones={phones}
          onSelect={handlePickPhone}
          onClose={() => setIsPicking(false)}
        />
      )}

      {isCreating && (
        <LeadFormDialog
          title="Agregar lead"
          submitLabel="Agregar"
          requirePhoneAndName
          initial={{ phone: selectedPhone ?? phones[0] ?? "", name: contact.name }}
          isSubmitting={isCreatingLead}
          error={error}
          onSubmit={handleCreateLead}
          onCancel={() => {
            setIsCreating(false);
            setError(null);
          }}
          onOpenExisting={(chat) => {
            setIsCreating(false);
            navigate(`/chat/${chat.chat_id}`);
          }}
        />
      )}
    </div>
  );
}

/** Selector de número cuando el contacto compartido trae más de uno — mismo
 * criterio que WhatsApp: hay que elegir con cuál abrir la conversación. */
function PhonePickerDialog({
  name,
  phones,
  onSelect,
  onClose,
}: {
  name: string;
  phones: string[];
  onSelect: (phone: string) => void;
  onClose: () => void;
}) {
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  async function handleCopy(phone: string) {
    await navigator.clipboard.writeText(formatPhone(phone));
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone((current) => (current === phone ? null : current)), 2000);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-wa-panel-dark`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                Elegí un número
              </Dialog.Title>
              <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">{name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 rounded-md p-1.5 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {phones.map((phone) => (
              <li key={phone} className="flex items-center gap-1 px-2">
                <button
                  type="button"
                  onClick={() => onSelect(phone)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-wa-hover dark:hover:bg-wa-hover-dark"
                >
                  <MessageCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-wa-primary-strong dark:text-wa-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm text-wa-text dark:text-wa-text-dark">
                    {formatPhone(phone)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy(phone)}
                  aria-label={copiedPhone === phone ? "Número copiado" : "Copiar número"}
                  title={copiedPhone === phone ? "Copiado" : "Copiar número"}
                  className="shrink-0 rounded-md p-1.5 text-wa-muted transition-colors hover:bg-black/10 hover:text-wa-text dark:text-wa-text-dark/60 dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
                >
                  {copiedPhone === phone ? (
                    <Check aria-hidden="true" className="h-4 w-4 text-wa-primary" />
                  ) : (
                    <Copy aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
