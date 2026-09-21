import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  MessagesSquare,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  PIN_LENGTH,
  useLogin,
  usePinLogin,
  usePinStatus,
} from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { extractErrorMessage } from "../utils/errors";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Input } from "./ui/Input";

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Ingresa tu email.")
    .email("Ingresa un email válido."),
  password: z.string().min(1, "Ingresa tu contraseña."),
  remember_device: z.boolean(),
});

type LoginValues = z.infer<typeof loginSchema>;

const authFieldClass =
  "h-12 rounded-xl border-wa-border bg-white pl-11 pr-4 text-[15px] shadow-sm placeholder:text-wa-muted/80 hover:border-gray-300 focus:border-wa-primary focus:bg-white focus:ring-4 focus:ring-wa-primary/10 dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:border-wa-muted/50 dark:focus:border-wa-primary dark:focus:bg-wa-head-dark";

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex shrink-0 items-center justify-center rounded-xl bg-wa-primary text-white shadow-[0_8px_24px_rgba(0,168,132,0.22)] ${compact ? "h-9 w-9" : "h-11 w-11"}`}
      >
        <MessagesSquare
          className={compact ? "h-4.5 w-4.5" : "h-5 w-5"}
          strokeWidth={2.2}
          aria-hidden="true"
        />
      </span>
      <span>
        <span className="block text-[15px] font-bold leading-tight tracking-[-0.02em] text-wa-text dark:text-white">
          CliniVentas
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-wa-muted dark:text-wa-muted-dark">
          CRM clínico
        </span>
      </span>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/80 dark:bg-red-950/35 dark:text-red-300"
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/60">
        <span className="text-xs font-bold" aria-hidden="true">
          !
        </span>
      </span>
      <span>{message}</span>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UsersRound;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-emerald-100 backdrop-blur-sm">
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-emerald-50/65">
          {description}
        </span>
      </span>
    </div>
  );
}

export function LoginPage() {
  const { data: pinStatus, isLoading: isLoadingPinStatus } = usePinStatus();
  const { mutate: login, isPending, error, reset: resetLogin } = useLogin();
  const {
    mutate: pinLogin,
    isPending: isPinPending,
    error: pinError,
    reset: resetPinLogin,
  } = usePinLogin();
  const { theme, toggleTheme } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [pin, setPin] = useState("");
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", remember_device: true },
  });

  const showPin = Boolean(pinStatus?.available) && !usePassword;

  function switchToPassword() {
    resetPinLogin();
    setPin("");
    setUsePassword(true);
  }

  function switchToPin() {
    resetLogin();
    setUsePassword(false);
  }

  return (
    <main className="relative h-full min-h-0 overflow-y-auto bg-[#f3f7f6] text-wa-text dark:bg-[#07110f] dark:text-wa-text-dark">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -left-24 -top-32 h-96 w-96 rounded-full bg-wa-primary/10 blur-3xl dark:bg-wa-primary/8" />
        <div className="absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-emerald-200/25 blur-3xl dark:bg-emerald-900/10" />
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-[1240px] flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <header className="flex h-12 shrink-0 items-center justify-between">
          <BrandMark compact />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
            }
            title={
              theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"
            }
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-wa-border bg-white/80 text-wa-muted shadow-sm backdrop-blur transition-colors hover:border-wa-primary/30 hover:text-wa-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:border-wa-border-dark dark:bg-wa-panel-dark/80 dark:text-wa-muted-dark dark:hover:text-wa-primary"
          >
            {theme === "dark" ? (
              <Sun className="h-4.5 w-4.5" aria-hidden="true" />
            ) : (
              <Moon className="h-4.5 w-4.5" aria-hidden="true" />
            )}
          </button>
        </header>

        <div className="flex flex-1 items-center py-4 sm:py-5 xl:py-8">
          <section className="mx-auto grid w-full max-w-[1080px] overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_24px_80px_-28px_rgba(15,43,36,0.28)] lg:grid-cols-[1.03fr_0.97fr] dark:border-white/10 dark:bg-wa-panel-dark dark:shadow-[0_28px_90px_-32px_rgba(0,0,0,0.8)]">
            <div className="relative hidden min-h-[600px] overflow-hidden bg-[#075e52] p-12 lg:flex lg:flex-col xl:p-14">
              <div
                className="pointer-events-none absolute inset-0"
                aria-hidden="true"
              >
                <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full border-[70px] border-white/[0.045]" />
                <div className="absolute -bottom-32 -left-28 h-80 w-80 rounded-full bg-wa-primary/30 blur-2xl" />
                <svg
                  viewBox="0 0 500 180"
                  className="absolute bottom-0 left-0 w-full opacity-[0.07]"
                  fill="none"
                >
                  <path
                    d="M-30 150C70 32 150 220 265 92C338 10 421 67 540 -6"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <path
                    d="M-40 175C81 58 168 234 280 119C367 30 438 80 550 22"
                    stroke="white"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-50 backdrop-blur-sm">
                  <Sparkles
                    className="h-3.5 w-3.5 text-emerald-200"
                    aria-hidden="true"
                  />
                  Tu operación, en un solo lugar
                </span>
                <h1 className="mt-7 max-w-md text-[38px] font-semibold leading-[1.08] tracking-[-0.045em] text-white xl:text-[42px]">
                  Convierte cada conversación en una mejor experiencia.
                </h1>
                <p className="mt-5 max-w-md text-sm leading-6 text-emerald-50/70">
                  Centraliza la atención, organiza a tu equipo y acompaña a cada
                  paciente desde el primer mensaje hasta su cita.
                </p>
              </div>

              <div className="relative mt-10 space-y-5">
                <Feature
                  icon={UsersRound}
                  title="Atención coordinada"
                  description="Todo el equipo trabaja con el mismo contexto del paciente."
                />
                <Feature
                  icon={CalendarCheck2}
                  title="Seguimiento sin olvidos"
                  description="Tareas, citas y recordatorios siempre visibles y ordenados."
                />
                <Feature
                  icon={ShieldCheck}
                  title="Acceso seguro"
                  description="Sesiones protegidas y acceso rápido con PIN por dispositivo."
                />
              </div>

              <div className="relative mt-auto pt-10">
                <div className="rounded-2xl border border-white/10 bg-[#064f46]/80 p-4 backdrop-blur-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-300/15 text-emerald-100">
                      <Check
                        className="h-4 w-4"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">
                        Todo listo para continuar
                      </p>
                      <p className="mt-0.5 text-[11px] text-emerald-50/55">
                        Tus conversaciones y tareas te esperan.
                      </p>
                    </div>
                    <span className="ml-auto h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_5px_rgba(110,231,183,0.1)]" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex min-h-[560px] items-center px-6 py-10 sm:px-10 sm:py-12 lg:min-h-[600px] lg:px-12 xl:px-16">
              <div className="mx-auto w-full max-w-[390px]">
                {isLoadingPinStatus ? (
                  <div
                    className="flex min-h-[360px] flex-col items-center justify-center"
                    role="status"
                    aria-label="Comprobando acceso"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary">
                      <Loader2
                        className="h-5 w-5 animate-spin"
                        aria-hidden="true"
                      />
                    </span>
                    <p className="mt-4 text-sm font-medium text-wa-text dark:text-wa-text-dark">
                      Preparando tu acceso…
                    </p>
                    <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
                      Esto solo tomará un momento.
                    </p>
                  </div>
                ) : showPin ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (pin.length === PIN_LENGTH) pinLogin(pin);
                    }}
                    noValidate
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong ring-1 ring-wa-primary/10 dark:bg-wa-primary/15 dark:text-wa-primary">
                      <KeyRound className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <p className="mt-7 text-xs font-semibold uppercase tracking-[0.14em] text-wa-primary-strong dark:text-wa-primary">
                      Acceso rápido
                    </p>
                    <h1 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-wa-text dark:text-white">
                      Hola, {pinStatus?.user_name?.split(" ")[0] || "de nuevo"}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                      Ingresa tu PIN de {PIN_LENGTH} dígitos para continuar.
                    </p>

                    <div className="mt-7 space-y-5">
                      {pinError && (
                        <ErrorNotice message={extractErrorMessage(pinError)} />
                      )}
                      <div>
                        <label
                          htmlFor="login-pin"
                          className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark"
                        >
                          PIN del dispositivo
                        </label>
                        <div className="relative">
                          <LockKeyhole
                            className="pointer-events-none absolute left-4 top-1/2 z-10 h-4.5 w-4.5 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark"
                            aria-hidden="true"
                          />
                          <Input
                            id="login-pin"
                            value={pin}
                            onChange={(event) => {
                              setPin(
                                event.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, PIN_LENGTH),
                              );
                              if (pinError) resetPinLogin();
                            }}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            maxLength={PIN_LENGTH}
                            placeholder="••••"
                            className={`${authFieldClass} pr-4 text-center font-mono text-xl font-semibold tracking-[0.7em] placeholder:tracking-[0.7em]`}
                            aria-describedby="login-pin-account"
                            aria-label={`PIN de ${PIN_LENGTH} dígitos`}
                          />
                        </div>
                        <p
                          id="login-pin-account"
                          className="mt-2 flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark"
                        >
                          <ShieldCheck
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {pinStatus?.masked_email}
                        </p>
                      </div>
                      <Button
                        type="submit"
                        disabled={isPinPending || pin.length !== PIN_LENGTH}
                        className="h-12 w-full rounded-xl text-sm shadow-[0_10px_24px_-10px_rgba(0,168,132,0.8)]"
                      >
                        {isPinPending ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <KeyRound className="h-4 w-4" aria-hidden="true" />
                        )}
                        {isPinPending ? "Verificando…" : "Ingresar con PIN"}
                        {!isPinPending && (
                          <ArrowRight
                            className="ml-1 h-4 w-4"
                            aria-hidden="true"
                          />
                        )}
                      </Button>
                    </div>

                    <div className="mt-7 border-t border-wa-border pt-5 text-center dark:border-wa-border-dark">
                      <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                        ¿No puedes usar tu PIN?
                      </p>
                      <button
                        type="button"
                        onClick={switchToPassword}
                        className="mt-1 rounded-md px-2 py-1 text-sm font-semibold text-wa-primary-strong outline-none transition-colors hover:text-wa-primary-deep focus-visible:ring-2 focus-visible:ring-wa-primary/50 dark:text-wa-primary"
                      >
                        Acceder con correo y contraseña
                      </button>
                    </div>
                  </form>
                ) : (
                  <form
                    onSubmit={handleSubmit((values) => login(values))}
                    noValidate
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong ring-1 ring-wa-primary/10 dark:bg-wa-primary/15 dark:text-wa-primary">
                      <MessagesSquare className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <p className="mt-7 text-xs font-semibold uppercase tracking-[0.14em] text-wa-primary-strong dark:text-wa-primary">
                      Bienvenido
                    </p>
                    <h1 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-wa-text dark:text-white">
                      Ingresa a tu cuenta
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                      Continúa donde lo dejaste y mantén tu atención al día.
                    </p>

                    <div className="mt-7 space-y-4">
                      {error && (
                        <ErrorNotice message={extractErrorMessage(error)} />
                      )}
                      <div>
                        <label
                          htmlFor="login-email"
                          className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark"
                        >
                          Correo electrónico
                        </label>
                        <div className="relative">
                          <Mail
                            className="pointer-events-none absolute left-4 top-1/2 z-10 h-4.5 w-4.5 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark"
                            aria-hidden="true"
                          />
                          <Input
                            id="login-email"
                            type="email"
                            {...register("email")}
                            autoComplete="username"
                            autoFocus
                            placeholder="nombre@clinica.com"
                            aria-invalid={!!errors.email}
                            aria-describedby={
                              errors.email ? "login-email-error" : undefined
                            }
                            className={authFieldClass}
                          />
                        </div>
                        {errors.email && (
                          <p
                            id="login-email-error"
                            className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400"
                          >
                            {errors.email.message}
                          </p>
                        )}
                      </div>
                      <div>
                        <label
                          htmlFor="login-password"
                          className="mb-2 block text-sm font-semibold text-wa-text dark:text-wa-text-dark"
                        >
                          Contraseña
                        </label>
                        <div className="relative">
                          <LockKeyhole
                            className="pointer-events-none absolute left-4 top-1/2 z-10 h-4.5 w-4.5 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark"
                            aria-hidden="true"
                          />
                          <Input
                            id="login-password"
                            type={showPassword ? "text" : "password"}
                            {...register("password")}
                            autoComplete="current-password"
                            placeholder="Ingresa tu contraseña"
                            aria-invalid={!!errors.password}
                            aria-describedby={
                              errors.password
                                ? "login-password-error"
                                : undefined
                            }
                            className={`${authFieldClass} pr-12`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((value) => !value)}
                            aria-label={
                              showPassword
                                ? "Ocultar contraseña"
                                : "Mostrar contraseña"
                            }
                            aria-pressed={showPassword}
                            className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-wa-muted outline-none transition-colors hover:bg-wa-hover hover:text-wa-text focus-visible:ring-2 focus-visible:ring-wa-primary/50 dark:text-wa-muted-dark dark:hover:bg-wa-active-dark dark:hover:text-wa-text-dark"
                          >
                            {showPassword ? (
                              <EyeOff
                                className="h-4.5 w-4.5"
                                aria-hidden="true"
                              />
                            ) : (
                              <Eye className="h-4.5 w-4.5" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        {errors.password && (
                          <p
                            id="login-password-error"
                            className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400"
                          >
                            {errors.password.message}
                          </p>
                        )}
                      </div>

                      <label
                        htmlFor="remember-device"
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-wa-border bg-[#f8faf9] p-3.5 transition-colors hover:border-wa-primary/30 dark:border-wa-border-dark dark:bg-wa-head-dark/55 dark:hover:border-wa-primary/30"
                      >
                        <Checkbox
                          id="remember-device"
                          checked={watch("remember_device")}
                          onCheckedChange={(checked) =>
                            setValue("remember_device", checked === true)
                          }
                          className="mt-0.5 h-4.5 w-4.5"
                        />
                        <span className="min-w-0">
                          <strong className="block text-xs font-semibold text-wa-text dark:text-wa-text-dark">
                            Recordar este dispositivo
                          </strong>
                          <span className="mt-0.5 block text-[11px] leading-4 text-wa-muted dark:text-wa-muted-dark">
                            Mantén la sesión activa y habilita el acceso rápido
                            con PIN.
                          </span>
                        </span>
                      </label>

                      <Button
                        type="submit"
                        disabled={isPending}
                        className="h-12 w-full rounded-xl text-sm shadow-[0_10px_24px_-10px_rgba(0,168,132,0.8)]"
                      >
                        {isPending && (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        )}
                        {isPending ? "Ingresando…" : "Ingresar a DermicaPro"}
                        {!isPending && (
                          <ArrowRight
                            className="ml-1 h-4 w-4"
                            aria-hidden="true"
                          />
                        )}
                      </Button>
                    </div>

                    {pinStatus?.available && (
                      <div className="mt-7 border-t border-wa-border pt-5 text-center dark:border-wa-border-dark">
                        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                          Este dispositivo tiene acceso rápido.
                        </p>
                        <button
                          type="button"
                          onClick={switchToPin}
                          className="mt-1 rounded-md px-2 py-1 text-sm font-semibold text-wa-primary-strong outline-none transition-colors hover:text-wa-primary-deep focus-visible:ring-2 focus-visible:ring-wa-primary/50 dark:text-wa-primary"
                        >
                          Volver a ingresar con PIN
                        </button>
                      </div>
                    )}
                  </form>
                )}
              </div>
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-center gap-1.5 pb-1 text-[11px] text-wa-muted/80 dark:text-wa-muted-dark/80">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Acceso privado y protegido
        </footer>
      </div>
    </main>
  );
}
