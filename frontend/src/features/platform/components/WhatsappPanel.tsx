import { AlertTriangle, ArrowRightLeft, CheckCircle2, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../shared/ui/Button";
import { extractErrorMessage } from "../../../shared/utils/errors";
import { useMetaEmbeddedSignup } from "../hooks/useMetaEmbeddedSignup";
import { useCompleteMetaEmbeddedSignup } from "../hooks/useSettings";
import { useCallingReadiness, useWhatsappStatus } from "../hooks/useWhatsapp";
import { CallsSettings } from "./CallsSettings";
import { MetaConnectGuide } from "./MetaConnectGuide";
import { MetaConversionsPanel } from "./MetaConversionsPanel";
import { BackToPhoneHint, MoveToCrmOnly } from "./NumberModeChange";
import { WhatsappCostsPanel } from "./WhatsappCostsPanel";

// Cómo quedó el número, preguntado a Meta (la misma consulta que usan las
// llamadas): cambia fuera del CRM si la clínica muda el número.
function LinkedMode({ onBusinessApp }: { onBusinessApp: boolean | null | undefined }) {
  const text =
    onBusinessApp === true
      ? "Número vinculado. Sigue funcionando en la app de WhatsApp Business."
      : onBusinessApp === false
        ? "Número vinculado solo al CRM. No funciona en la app del celular."
        : "Número vinculado.";
  return (
    <p className="flex items-center gap-1.5 text-xs text-wa-primary-strong dark:text-wa-primary">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      {text}
    </p>
  );
}

// El negocio desvinculó el número desde WhatsApp (o borró la cuenta): Meta lo
// avisó y desde entonces no pasa ningún mensaje. Se dice con la hora para
// que se pueda revisar qué quedó sin atender.
function DisconnectedNotice({ since }: { since: string | null | undefined }) {
  const when = since
    ? new Date(since).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })
    : null;
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">Este número se desvinculó de Meta{when ? ` el ${when}` : ""}.</strong>{" "}
        Desde entonces no salen ni llegan mensajes. Vuelve a vincularlo para reanudar los chats.
      </span>
    </p>
  );
}

// Conexión con Meta (WhatsApp Embedded Signup), con los dos caminos: el
// número que ya está en la app de WhatsApp Business sigue ahí (coexistencia),
// o un número queda solo en el CRM. Completa las mismas credenciales que se
// pueden tipear a mano en las claves de Meta (meta_access_token/waba_id/
// phone_number_id). El número de avisos de cita se vincula aparte, en su
// propia tarjeta: este botón reemplaza el número de los chats. Mudar el mismo
// número de un modo al otro tiene su propia guía (NumberModeChange.tsx).
function MetaEmbeddedSignupPanel() {
  const { data: whatsappStatus } = useWhatsappStatus();
  const isLinked = whatsappStatus?.state === "open";
  const isDisconnected = whatsappStatus?.state === "disconnected";
  const { data: readiness } = useCallingReadiness(isLinked);
  // `choosing`: elegir modo para otro número; `moving`: mudar este mismo
  // número de la app del celular a solo CRM.
  const [view, setView] = useState<"idle" | "choosing" | "moving">("idle");
  const onBusinessApp = isLinked ? readiness?.on_business_app : undefined;
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
          Conexión con Meta
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
        Conexión con Meta
      </div>
      {isLinked ? (
        <LinkedMode onBusinessApp={onBusinessApp} />
      ) : isDisconnected ? (
        <DisconnectedNotice since={whatsappStatus?.disconnected_at} />
      ) : (
        <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
          Vincula el número que ya usas en WhatsApp Business sin sacarlo del
          celular, o un número solo para el CRM.
        </p>
      )}
      {view === "choosing" && (
        <MetaConnectGuide
          onCancel={() => setView("idle")}
          onContinue={mode => {
            setView("idle");
            setSuccess(false);
            signup.start(mode);
          }}
          disabled={!signup.ready}
          pending={isPending}
        />
      )}
      {view === "moving" && (
        <MoveToCrmOnly
          onCancel={() => setView("idle")}
          onContinue={() => {
            setView("idle");
            setSuccess(false);
            signup.start("cloud_api");
          }}
          disabled={!signup.ready}
          pending={isPending}
        />
      )}
      {view === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setView("choosing")}
            disabled={!signup.ready || isPending}
            variant="ghost"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Link2 className="h-4 w-4" aria-hidden="true" />
            )}
            {isLinked ? "Conectar otro número" : isDisconnected ? "Volver a vincular" : "Vincular con Meta"}
          </Button>
          {onBusinessApp === true && (
            <Button
              onClick={() => setView("moving")}
              disabled={!signup.ready || isPending}
              variant="ghost"
            >
              <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
              Pasar este número a solo CRM
            </Button>
          )}
        </div>
      )}
      {view === "idle" && onBusinessApp === false && <BackToPhoneHint />}
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

export function WhatsappPanel() {
  const { data: whatsappStatus } = useWhatsappStatus();
  return (
    <div className="space-y-4">
      <MetaEmbeddedSignupPanel />
      {whatsappStatus?.state === "open" && <WhatsappCostsPanel />}
      {whatsappStatus?.state === "open" && <MetaConversionsPanel />}
      {whatsappStatus?.state === "open" && <CallsSettings />}
    </div>
  );
}
