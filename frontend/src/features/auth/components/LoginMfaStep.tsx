import { ArrowLeft, ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/Input";
import { authFieldClass, ErrorNotice } from "./authFormParts";

const TOTP_LENGTH = 6;
// Los de recuperación son 20 caracteres hexadecimales en grupos de 5
// (backend/app/modules/auth/admin_totp.py); se aceptan con o sin guiones.
const RECOVERY_MAX_LENGTH = 23;

/** Segundo paso del login: solo aparece cuando el backend responde que la
 *  cuenta tiene la verificación en dos pasos activa. */
export function LoginMfaStep({
  email,
  isPending,
  errorMessage,
  onSubmit,
  onBack,
  onEdit,
}: {
  email: string;
  isPending: boolean;
  errorMessage: string | null;
  onSubmit: (code: string) => void;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");

  const ready = useRecovery
    ? code.replace(/-/g, "").length === 20
    : code.length === TOTP_LENGTH;

  function toggleMode() {
    setUseRecovery((value) => !value);
    setCode("");
    onEdit();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit(code);
      }}
      noValidate
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong ring-1 ring-wa-primary/10 dark:bg-wa-primary/15 dark:text-wa-primary">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
      </div>
      <p className="mt-7 text-xs font-semibold uppercase tracking-[0.14em] text-wa-primary-strong dark:text-wa-primary">
        Verificación en dos pasos
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-wa-text dark:text-white">
        Confirma que eres tú
      </h1>
      <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        {useRecovery
          ? "Ingresa uno de los códigos de recuperación que guardaste al activar la verificación. Cada uno sirve una sola vez."
          : `Abre tu app de autenticación e ingresa el código de ${TOTP_LENGTH} dígitos de ${email}.`}
      </p>

      <div className="mt-7 space-y-5">
        {errorMessage && <ErrorNotice message={errorMessage} />}
        <div>
          <label
            htmlFor="login-mfa"
            className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark"
          >
            {useRecovery ? "Código de recuperación" : "Código de verificación"}
          </label>
          <div className="relative">
            <KeyRound
              className="pointer-events-none absolute left-4 top-1/2 z-10 h-4.5 w-4.5 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark"
              aria-hidden="true"
            />
            <Input
              id="login-mfa"
              key={useRecovery ? "recovery" : "totp"}
              value={code}
              onChange={(event) => {
                const value = event.target.value;
                setCode(
                  useRecovery
                    ? value.toUpperCase().replace(/[^0-9A-F-]/g, "").slice(0, RECOVERY_MAX_LENGTH)
                    : value.replace(/\D/g, "").slice(0, TOTP_LENGTH),
                );
                if (errorMessage) onEdit();
              }}
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoFocus
              placeholder={useRecovery ? "XXXXX-XXXXX-XXXXX-XXXXX" : "000000"}
              className={
                useRecovery
                  ? `${authFieldClass} font-mono tracking-wider`
                  : `${authFieldClass} text-center font-mono text-xl font-semibold tracking-[0.5em] placeholder:tracking-[0.5em]`
              }
            />
          </div>
          <button
            type="button"
            onClick={toggleMode}
            className="mt-2 rounded-md text-xs font-semibold text-wa-primary-strong outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/50 dark:text-wa-primary"
          >
            {useRecovery
              ? "Usar el código de la app"
              : "No tengo mi teléfono: usar un código de recuperación"}
          </button>
        </div>

        <Button
          type="submit"
          disabled={isPending || !ready}
          className="h-12 w-full rounded-xl text-sm shadow-[0_10px_24px_-10px_var(--accent)]"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {isPending ? "Verificando…" : "Verificar e ingresar"}
          {!isPending && <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>

      <div className="mt-7 border-t border-wa-border pt-5 text-center dark:border-wa-border-dark">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-wa-primary-strong outline-none transition-colors hover:text-wa-primary-deep focus-visible:ring-2 focus-visible:ring-wa-primary/50 dark:text-wa-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Usar otra cuenta
        </button>
      </div>
    </form>
  );
}
