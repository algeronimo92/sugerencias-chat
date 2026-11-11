import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Building2, Globe2, Layers, Loader2, LockKeyhole, Mail, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTheme } from '../../../../shared/hooks/useTheme'
import { Button } from '../../../../shared/ui/Button'
import { Input } from '../../../../shared/ui/Input'
import { loginOperator } from '../../api'
import { mensajeDeError } from './errors'
import { AvisoError, MarcaPlataforma } from './PanelUi'

const campoClass =
  "h-12 rounded-xl border-wa-border bg-white pl-11 pr-4 text-[15px] shadow-sm placeholder:text-wa-muted/80 hover:border-gray-300 focus:border-wa-primary focus:bg-white focus:ring-4 focus:ring-wa-primary/10 dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:border-wa-muted/50 dark:focus:border-wa-primary dark:focus:bg-wa-head-dark";

function Capacidad({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white backdrop-blur-sm">
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/65">
          {description}
        </span>
      </span>
    </div>
  );
}

export function PlatformLogin({ onEntrar }: { onEntrar: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const entrar = useMutation({
    mutationFn: async () => {
      await loginOperator(email, password);
    },
    onSuccess: onEntrar,
  });

  return (
    <main className="relative h-full overflow-x-hidden overflow-y-auto bg-[#f5f6fb] text-wa-text dark:bg-[#0a0b14] dark:text-wa-text-dark">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 -top-32 h-96 w-96 rounded-full bg-wa-primary/10 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-wa-accent/15 blur-3xl dark:bg-wa-primary/10" />
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-[1240px] flex-col px-4 pb-4 pt-4 sm:px-6 lg:px-8">
        <header className="flex h-12 shrink-0 items-center justify-between">
          <MarcaPlataforma />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-wa-border bg-white/80 text-wa-muted shadow-sm backdrop-blur transition-colors hover:border-wa-primary/40 hover:text-wa-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/50 dark:border-wa-border-dark dark:bg-wa-panel-dark/80 dark:text-wa-muted-dark dark:hover:text-wa-primary"
          >
            {theme === "dark" ? (
              <Sun className="h-4.5 w-4.5" aria-hidden="true" />
            ) : (
              <Moon className="h-4.5 w-4.5" aria-hidden="true" />
            )}
          </button>
        </header>

        <div className="flex flex-1 items-center py-4 sm:py-5 xl:py-8">
          <section className="mx-auto grid w-full max-w-[1080px] overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_24px_80px_-28px_rgba(23,23,54,0.28)] lg:grid-cols-[1.03fr_0.97fr] dark:border-white/10 dark:bg-wa-panel-dark dark:shadow-[0_28px_90px_-32px_rgba(0,0,0,0.8)]">
            {/* El panel izquierdo va en índigo y no en el verde del CRM a
                propósito: es la señal de que esto administra negocios, no de
                que sea el CRM de alguno. */}
            <div className="relative hidden min-h-[560px] overflow-hidden bg-wa-primary-deep p-12 lg:flex lg:flex-col xl:p-14">
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full border-[70px] border-white/[0.045]" />
                <div className="absolute -bottom-32 -left-28 h-80 w-80 rounded-full bg-wa-accent/20 blur-2xl" />
              </div>

              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                  <ShieldCheck className="h-3.5 w-3.5 text-white/80" aria-hidden="true" />
                  Acceso restringido a operadores
                </span>
                <h1 className="mt-7 max-w-md text-[38px] font-semibold leading-[1.08] tracking-[-0.045em] text-white xl:text-[42px]">
                  Un lugar para administrar cada negocio.
                </h1>
                <p className="mt-5 max-w-md text-sm leading-6 text-white/70">
                  Da de alta clínicas, gestiona sus dominios y controla su acceso.
                  Cada una queda aislada en su propio esquema.
                </p>
              </div>

              <div className="relative mt-10 space-y-5">
                <Capacidad
                  icon={Building2}
                  title="Alta en un paso"
                  description="Crea el esquema del negocio, lo migra y siembra su primer admin."
                />
                <Capacidad
                  icon={Globe2}
                  title="Dominios propios"
                  description="Cada negocio entra por su subdominio, con los que necesite."
                />
                <Capacidad
                  icon={ShieldCheck}
                  title="Control de acceso"
                  description="Suspende un negocio y sus sesiones abiertas se cortan al instante."
                />
              </div>
            </div>

            <div className="flex min-h-[520px] items-center px-6 py-10 sm:px-10 sm:py-12 lg:min-h-[560px] lg:px-12 xl:px-16">
              <form
                className="mx-auto w-full max-w-[390px]"
                noValidate
                onSubmit={(evento) => {
                  evento.preventDefault();
                  entrar.mutate();
                }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary-strong ring-1 ring-wa-primary/10 dark:bg-wa-primary/15 dark:text-wa-primary">
                  <Layers className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="mt-7 text-xs font-semibold uppercase tracking-[0.14em] text-wa-primary-strong dark:text-wa-primary">
                  Operadores
                </p>
                <h2 className="mt-2 text-3xl font-bold tracking-[-0.035em] text-wa-text dark:text-white">
                  Ingresa al panel
                </h2>
                <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                  Administra los negocios de la plataforma.
                </p>

                <div className="mt-7 space-y-5">
                  {entrar.isError && <AvisoError mensaje={mensajeDeError(entrar.error)} />}

                  <div>
                    <label
                      htmlFor="platform-email"
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
                        id="platform-email"
                        type="email"
                        autoComplete="username"
                        placeholder="operador@cliniventas.com"
                        className={campoClass}
                        value={email}
                        onChange={(evento) => setEmail(evento.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="platform-password"
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
                        id="platform-password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Ingresa tu contraseña"
                        className={campoClass}
                        value={password}
                        onChange={(evento) => setPassword(evento.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={entrar.isPending}
                    className="h-12 w-full rounded-xl bg-wa-primary text-sm shadow-[0_10px_24px_-10px_rgba(0,168,132,0.8)] hover:bg-wa-primary-strong"
                  >
                    {entrar.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {entrar.isPending ? "Entrando…" : "Entrar al panel"}
                    {!entrar.isPending && (
                      <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>

                <p className="mt-7 flex items-center justify-center gap-1.5 border-t border-wa-border pt-5 text-xs text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Este panel no está disponible desde el dominio de un negocio.
                </p>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
