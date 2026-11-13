import { CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../shared/ui/Button";
import { extractErrorMessage } from "../../../shared/utils/errors";
import { useMetaEmbeddedSignup } from "../hooks/useMetaEmbeddedSignup";
import { useCompleteMetaEmbeddedSignup } from "../hooks/useSettings";
import { useWhatsappStatus } from "../hooks/useWhatsapp";
import { WhatsappCostsPanel } from "./WhatsappCostsPanel";
interface Props {
  onGoToClaves: () => void;
}

// Panel de coexistencia con Meta (WhatsApp Embedded Signup): vincula un
// número que ya está activo en la app oficial de WhatsApp Business sin
// desconectarlo de ahí. Completa las mismas credenciales que se pueden
// tipear a mano en las claves de Meta (meta_access_token/waba_id/phone_number_id).
// El número de avisos de cita se vincula aparte, en su propia tarjeta: este
// botón reemplaza el número de los chats.
function MetaEmbeddedSignupPanel() {
  const { data: whatsappStatus } = useWhatsappStatus();
  const isLinked = whatsappStatus?.state === "open";
  const { mutate: complete, isPending } = useCompleteMetaEmbeddedSignup();
  const [success, setSuccess] = useState(false);
  const signup = useMetaEmbeddedSignup(payload =>
    complete(payload, {
      onSuccess: () => {
        setSuccess(true);
        toast.success("WhatsApp vinculado con Meta");
      },
      onError: err => signup.setError(extractErrorMessage(err)),
    }),
  );

  if (signup.loading) return null;

  if (!signup.configured) {
    return (
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
          <Link2 className="h-4 w-4" />
          Coexistencia con Meta
        </div>
        <p className="text-[11px] text-amber-800 dark:text-amber-300">
          El operador de plataforma todavía no configuró el App ID y el Configuration ID de Embedded Signup.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark">
      <div className="flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
        <Link2 className="h-4 w-4" />
        Coexistencia con Meta
      </div>
      {isLinked ? (
        <p className="flex items-center gap-1.5 text-xs text-wa-primary-strong dark:text-wa-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Número vinculado. Sigue usándolo también desde la app de WhatsApp
          Business.
        </p>
      ) : (
        <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
          Vincula un número que ya usas en la app oficial de WhatsApp Business
          sin desconectarlo de ahí. Reemplaza tener que copiar el token, el WABA
          id y el phone number id a mano.
        </p>
      )}
      <Button
        onClick={() => {
          setSuccess(false);
          signup.start();
        }}
        disabled={!signup.ready || isPending}
        variant="ghost"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden="true" />
        )}
        {isLinked ? "Cambiar el número de los chats" : "Vincular con Meta"}
      </Button>
      {success && (
        <p className="flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> Credenciales guardadas.
        </p>
      )}
      {signup.error && (
        <p className="text-xs text-red-500 dark:text-red-400">{signup.error}</p>
      )}
    </div>
  );
}

export function WhatsappPanel({ onGoToClaves }: Props) {
  const { data: whatsappStatus } = useWhatsappStatus();
  return (
    <div className="space-y-4">
      <MetaEmbeddedSignupPanel />
      {whatsappStatus?.state === "open" && <WhatsappCostsPanel />}
      <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
        También puedes completar el token, el waba id y el phone number id{" "}
        <button
          type="button"
          onClick={onGoToClaves}
          className="font-medium text-wa-primary-strong underline dark:text-wa-primary"
        >
          a mano, en las claves de Meta
        </button>
        .
      </p>
    </div>
  );
}
