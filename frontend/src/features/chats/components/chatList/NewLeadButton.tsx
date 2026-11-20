import { UserPlus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "../../../../shared/ui/Button";
import { extractErrorMessage } from "../../../../shared/utils/errors";
import { useCreateLead } from "../../../leads/public/queries";
import type { Chat, LeadUpdateInput } from "../../../leads/types";

// Diálogos que solo se abren a pedido: fuera del bundle inicial.
const LeadFormDialog = lazy(() =>
  import("../../../leads/public/LeadFormDialog").then((m) => ({ default: m.LeadFormDialog })),
);

/** Botón "Nuevo" de la lista con su diálogo de alta. Al crear el lead, o al
 * elegir uno que ya existía con ese teléfono, lo abre con `onOpen`. */
export function NewLeadButton({ onOpen }: { onOpen: (chat: Chat) => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const { mutate: createLead, isPending: isSavingNewLead } = useCreateLead();

  function handleCreateLead(values: LeadUpdateInput) {
    if (isSavingNewLead) return;
    setCreateError(null);
    createLead(
      {
        phone: values.phone ?? "",
        name: values.name ?? "",
        servicio_interes: values.servicio_interes,
        vendedor_id: values.vendedor_id,
        origen: values.origen,
        notas: values.notas,
        secondary_phone: values.secondary_phone,
        custom_fields: values.custom_fields,
      },
      {
        onSuccess: (chat) => {
          setIsCreating(false);
          onOpen(chat);
        },
        onError: (err) => setCreateError(extractErrorMessage(err)),
      },
    );
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setCreateError(null);
          setIsCreating(true);
        }}
        aria-label="Nuevo lead"
        title="Nuevo lead"
        className="h-8 shrink-0 rounded-lg px-2.5"
      >
        <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
        Nuevo
      </Button>
      <Suspense fallback={null}>
        {isCreating && (
          <LeadFormDialog
            title="Agregar lead"
            submitLabel="Agregar"
            requirePhoneAndName
            isSubmitting={isSavingNewLead}
            error={createError}
            onSubmit={handleCreateLead}
            onCancel={() => setIsCreating(false)}
            onOpenExisting={(chat) => {
              setIsCreating(false);
              onOpen(chat);
            }}
          />
        )}
      </Suspense>
    </>
  );
}
