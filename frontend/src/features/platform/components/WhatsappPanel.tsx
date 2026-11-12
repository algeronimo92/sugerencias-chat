import { CheckCircle2, Link2, Loader2, QrCode, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../shared/ui/Button";
import { Input, labelClass } from "../../../shared/ui/Input";
import { extractErrorMessage } from "../../../shared/utils/errors";
import { useFacebookSdk } from "../hooks/useFacebookSdk";
import { useCompleteMetaEmbeddedSignup, useMetaPublicConfig } from "../hooks/useSettings";
import {
  useConnectEvolution,
  useEvolutionStatus,
  useRemoveEvolution,
  useWhatsappStatus,
} from "../hooks/useWhatsapp";
import type { EvolutionStatus } from "../types";
import { WhatsappCostsPanel } from "./WhatsappCostsPanel";
interface Props {
  onGoToClaves: () => void;
}

// Compatibilidad de despliegue durante la migración al panel global. Los
// valores del backend ganan; estas variables se pueden retirar cuando la
// configuración de plataforma ya esté cargada.
const LEGACY_META_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined;
const LEGACY_META_CONFIG_ID = import.meta.env.VITE_FACEBOOK_CONFIG_ID as string | undefined;

interface EmbeddedSignupData {
  phone_number_id?: string;
  waba_id?: string;
}

function isEmbeddedSignupMessage(
  data: unknown,
): data is { type: string; event: string; data?: EmbeddedSignupData } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "WA_EMBEDDED_SIGNUP"
  );
}

// Panel de coexistencia con Meta (WhatsApp Embedded Signup): vincula un
// número que ya está activo en la app oficial de WhatsApp Business sin
// desconectarlo de ahí. Completa las mismas credenciales que se pueden
// tipear a mano en las claves de Meta (meta_access_token/waba_id/phone_number_id).
function MetaEmbeddedSignupPanel() {
  const { data: metaConfig, isLoading: isLoadingMetaConfig } = useMetaPublicConfig();
  const metaAppId = metaConfig?.app_id || LEGACY_META_APP_ID;
  const metaConfigId = metaConfig?.config_id || LEGACY_META_CONFIG_ID;
  // El SDK se inicializa una sola vez por página: esperar al backend evita
  // que quede atado al app id de respaldo mientras la consulta sigue en vuelo.
  const sdkReady = useFacebookSdk(isLoadingMetaConfig ? undefined : metaAppId);
  const { data: whatsappStatus } = useWhatsappStatus();
  const isLinked = whatsappStatus?.state === "open";
  const { mutate: complete, isPending } = useCompleteMetaEmbeddedSignup();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // El `code` de FB.login() y el {waba_id, phone_number_id} del postMessage
  // de Meta llegan por separado y en cualquier orden; se juntan acá antes de
  // mandarlos al backend.
  const pendingCode = useRef<string | null>(null);
  const pendingSignupData = useRef<EmbeddedSignupData | null>(null);

  function trySubmit() {
    const code = pendingCode.current;
    const data = pendingSignupData.current;
    // El phone_number_id es opcional: el evento de coexistencia
    // (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) no lo manda -- el backend lo
    // resuelve solo a partir de la WABA (ver meta_service.py).
    if (!code || !data?.waba_id) return;
    pendingCode.current = null;
    pendingSignupData.current = null;
    setError(null);
    complete(
      { code, waba_id: data.waba_id, phone_number_id: data.phone_number_id },
      {
        onSuccess: () => {
          setSuccess(true);
          toast.success("WhatsApp vinculado con Meta");
        },
        onError: (err) => setError(extractErrorMessage(err)),
      },
    );
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      )
        return;
      let payload: unknown;
      try {
        payload =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!isEmbeddedSignupMessage(payload)) return;
      // 'FINISH' es el signup normal (WABA + número nuevo); en coexistencia
      // con la app de WhatsApp Business el evento es distinto y su payload
      // trae solo waba_id -- ver docs de Meta sobre Embedded Signup.
      if (
        (payload.event === "FINISH" ||
          payload.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") &&
        payload.data
      ) {
        pendingSignupData.current = payload.data;
        trySubmit();
      } else if (payload.event === "CANCEL" || payload.event === "ERROR") {
        setError("Se canceló la vinculación con Meta.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogin() {
    if (!window.FB || !metaConfigId) return;
    setError(null);
    setSuccess(false);
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          if (response.status !== "connected")
            setError("Se canceló la vinculación con Meta.");
          return;
        }
        pendingCode.current = code;
        trySubmit();
      },
      {
        config_id: metaConfigId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  if (isLoadingMetaConfig) return null;

  if (!metaAppId || !metaConfigId) {
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
        onClick={handleLogin}
        disabled={!sdkReady || isPending}
        variant="ghost"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Link2 className="h-4 w-4" aria-hidden="true" />
        )}
        {isLinked ? "Vincular otro número" : "Vincular con Meta"}
      </Button>
      {success && (
        <p className="flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> Credenciales guardadas.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function qrSource(value: string): string {
  return value.startsWith("data:") ? value : `data:image/png;base64,${value}`;
}

/** Conexión adicional por Evolution API. Meta puede seguir activa a la vez. */
function EvolutionPanel() {
  const { data: status, isLoading, error: statusError } = useEvolutionStatus();
  const { mutate: connect, isPending: isConnecting } = useConnectEvolution();
  const { mutate: remove, isPending: isRemoving } = useRemoveEvolution();
  const [phone, setPhone] = useState("");
  const [connection, setConnection] = useState<EvolutionStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const state = status?.state;

  useEffect(() => {
    if (state === "open" || state === "missing") setConnection(null);
  }, [state]);

  function handleConnect(event: React.FormEvent) {
    event.preventDefault();
    setActionError(null);
    connect(phone, {
      onSuccess: result => setConnection(result),
      onError: err => setActionError(extractErrorMessage(err)),
    });
  }

  function handleRemove() {
    setActionError(null);
    remove(undefined, {
      onSuccess: () => {
        setConnection(null);
        setPhone("");
        toast.success("Conexión Evolution eliminada");
      },
      onError: err => setActionError(extractErrorMessage(err)),
    });
  }

  const qr = connection?.qr_base64;
  const pairingCode = connection?.pairing_code;

  return (
    <div className="space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark">
      <div className="flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
        <QrCode className="h-4 w-4" />
        Evolution API
      </div>
      <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
        Vincula otro número como dispositivo. Sus mensajes entran al CRM y las
        respuestas salen por la misma conexión; Meta puede seguir activa.
      </p>

      {isLoading ? (
        <p className="flex items-center gap-2 text-xs text-wa-muted dark:text-wa-muted-dark">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando Evolution…
        </p>
      ) : state === "not_configured" ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          El operador debe configurar Evolution API y su webhook público.
        </p>
      ) : state === "open" ? (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-wa-primary-strong dark:text-wa-primary">
            <CheckCircle2 className="h-4 w-4" /> WhatsApp conectado mediante Evolution
          </p>
          {status?.webhook_configured === false && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Falta la URL y el token del webhook público: los envíos salen, pero
              los mensajes de los clientes no entran al CRM hasta configurarlos.
            </p>
          )}
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={isRemoving}>
            {isRemoving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Desconectar Evolution
          </Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={handleConnect}>
          <div>
            <label htmlFor="evolution-phone" className={labelClass}>Número con código de país</label>
            <Input
              id="evolution-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="Ej. 51987654321"
              value={phone}
              onChange={event => setPhone(event.target.value)}
              disabled={isConnecting}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={isConnecting || phone.trim().length < 8}>
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            {state === "connecting" ? "Volver a generar código" : "Conectar con Evolution"}
          </Button>
        </form>
      )}

      {qr && state !== "open" && (
        <div className="space-y-2 text-center">
          <div className="mx-auto w-fit rounded-xl border border-wa-border bg-white p-3 dark:border-wa-border-dark">
            <img src={qrSource(qr)} alt="Código QR para vincular WhatsApp" className="h-52 w-52 max-w-full" />
          </div>
          <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
            En WhatsApp: Dispositivos vinculados → Vincular un dispositivo.
          </p>
        </div>
      )}
      {pairingCode && state !== "open" && (
        <p className="text-center text-xs text-wa-muted dark:text-wa-muted-dark">
          Código de vinculación: <strong className="font-mono tracking-widest text-wa-text dark:text-wa-text-dark">{pairingCode}</strong>
        </p>
      )}
      {state === "connecting" && !qr && !pairingCode && (
        <p className="flex items-center gap-2 text-xs text-wa-muted dark:text-wa-muted-dark">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Esperando la vinculación…
        </p>
      )}
      {(actionError || statusError) && (
        <p role="alert" className="text-xs text-red-500 dark:text-red-400">
          {actionError || "No se pudo consultar Evolution API."}
        </p>
      )}
    </div>
  );
}

export function WhatsappPanel({ onGoToClaves }: Props) {
  const { data: whatsappStatus } = useWhatsappStatus();
  return (
    <div className="space-y-4">
      <MetaEmbeddedSignupPanel />
      <EvolutionPanel />
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
