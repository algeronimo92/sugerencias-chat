/**
 * Panel de plataforma: alta y administración de negocios.
 *
 * Deliberadamente aislado del CRM: su propia sesión (cookie distinta), sus
 * propias llamadas (`/api/platform/*`) y ningún import del árbol de chats. El
 * backend solo lo atiende en los hosts de plataforma; en el dominio de un
 * negocio estas rutas devuelven 404 y acá se ve como "panel no disponible".
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  KeyRound,
  Layers,
  LogOut,
  Loader2,
  LockKeyhole,
  Mail,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import client from "../api/client";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { DialogPrimitive, dialogContentPositionClass, dialogOverlayClass } from "../components/ui/Dialog";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

type Domain = { id: string; hostname: string; is_primary: boolean };

type Organization = {
  id: string;
  name: string;
  status: string;
  schema_name: string;
  storage_prefix: string | null;
  created_at: string | null;
  revision: string | null;
  migration_status: string | null;
  up_to_date: boolean;
  domains: Domain[];
};

type OperadorActual = { id: string; email: string; name: string };

const ORGANIZACIONES = ["platform", "organizations"] as const;

function mensajeDeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // El 404 puede venir del middleware de tenancy ("Tenant not found") antes
    // de llegar al panel: desde el dominio de un negocio estas rutas no
    // existen, y ese detalle genérico no le dice nada a quien lo lee.
    if (error.response?.status === 404) {
      return "El panel solo está disponible en el dominio de la plataforma.";
    }
    const detalle = error.response?.data?.detail;
    if (typeof detalle === "string") return detalle;
  }
  return "No se pudo completar la operación.";
}

const campoClass =
  "h-12 rounded-xl border-wa-border bg-white pl-11 pr-4 text-[15px] shadow-sm placeholder:text-wa-muted/80 hover:border-gray-300 focus:border-wa-primary focus:bg-white focus:ring-4 focus:ring-wa-primary/10 dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:border-wa-muted/50 dark:focus:border-wa-primary dark:focus:bg-wa-head-dark";

function MarcaPlataforma() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wa-primary text-white shadow-[0_8px_24px_rgba(0,168,132,0.24)]">
        <Layers className="h-4.5 w-4.5" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[15px] font-bold leading-tight tracking-[-0.02em] text-wa-text dark:text-white">
          Cliniventas
        </span>
        <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-wa-muted dark:text-wa-muted-dark">
          Panel de plataforma
        </span>
      </span>
    </div>
  );
}

function AvisoError({ mensaje }: { mensaje: string }) {
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
      <span>{mensaje}</span>
    </div>
  );
}

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

function Login({ onEntrar }: { onEntrar: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const entrar = useMutation({
    mutationFn: async () => {
      await client.post("/api/platform/auth/login", { email, password });
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

function NuevoNegocio({ onCreado }: { onCreado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      await client.post("/api/platform/organizations", {
        name,
        hostname,
        admin_email: adminEmail || null,
        admin_password: adminPassword || null,
      });
    },
    onSuccess: () => {
      setName("");
      setHostname("");
      setAdminEmail("");
      setAdminPassword("");
      setAbierto(false);
      onCreado();
    },
  });

  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={(open) => { if (!crear.isPending) setAbierto(open); }}>
      <DialogPrimitive.Trigger asChild>
        <Button className="h-11 gap-2 bg-wa-primary-strong px-4 text-sm hover:bg-wa-primary-deep">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo negocio
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClass} />
        <DialogPrimitive.Content className={`${dialogContentPositionClass} max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-wa-border bg-white p-5 shadow-xl sm:p-8 dark:border-wa-border-dark dark:bg-wa-panel-dark`} onEscapeKeyDown={(evento) => { if (crear.isPending) evento.preventDefault(); }} onPointerDownOutside={(evento) => { if (crear.isPending) evento.preventDefault(); }}>
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          crear.mutate();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4">
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-wa-primary-strong sm:flex dark:bg-wa-primary/15 dark:text-wa-primary">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <DialogPrimitive.Title className="text-xl font-bold tracking-[-0.025em] text-wa-text dark:text-white">Crear negocio</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 max-w-lg text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                Prepara el espacio y el dominio principal. La cuenta administradora es opcional.
              </DialogPrimitive.Description>
            </div>
          </div>
          <button type="button" onClick={() => setAbierto(false)} disabled={crear.isPending} aria-label="Cerrar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark">
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <CampoNegocio label="Nombre" icon={Building2}>
            <input className="h-11 w-full bg-transparent px-3 text-sm text-wa-text outline-none placeholder:text-wa-muted/70 dark:text-white" value={name} onChange={(evento) => setName(evento.target.value)} placeholder="Clínica Norte" autoFocus required />
          </CampoNegocio>
          <CampoNegocio label="Dominio principal" icon={Globe2}>
            <input className="h-11 w-full bg-transparent px-3 text-sm text-wa-text outline-none placeholder:text-wa-muted/70 dark:text-white" value={hostname} onChange={(evento) => setHostname(evento.target.value)} placeholder="norte.cliniventas.com" required />
          </CampoNegocio>
          <CampoNegocio label="Correo del administrador" icon={Mail} optional>
            <input type="email" className="h-11 w-full bg-transparent px-3 text-sm text-wa-text outline-none placeholder:text-wa-muted/70 dark:text-white" value={adminEmail} onChange={(evento) => setAdminEmail(evento.target.value)} placeholder="admin@clinicanorte.com" />
          </CampoNegocio>
          <CampoNegocio label="Contraseña inicial" icon={KeyRound} optional>
            <input type="password" minLength={8} className="h-11 w-full bg-transparent px-3 text-sm text-wa-text outline-none placeholder:text-wa-muted/70 dark:text-white" value={adminPassword} onChange={(evento) => setAdminPassword(evento.target.value)} placeholder="Mínimo 8 caracteres" />
          </CampoNegocio>
        </div>

        {crear.isError && <div className="mt-5"><AvisoError mensaje={mensajeDeError(crear.error)} /></div>}

        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-wa-border pt-5 sm:flex-row sm:items-center sm:justify-end dark:border-white/10">
          <button type="button" onClick={() => setAbierto(false)} disabled={crear.isPending} className="h-11 rounded-xl border border-wa-border px-5 text-sm font-semibold text-wa-muted transition hover:bg-gray-50 hover:text-wa-text disabled:opacity-50 dark:border-white/10 dark:text-wa-muted-dark dark:hover:bg-white/5 dark:hover:text-white">Cancelar</button>
          <button type="submit" disabled={crear.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-wa-primary-strong px-5 text-sm font-semibold text-white transition hover:bg-wa-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-wait disabled:opacity-60">
            {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {crear.isPending ? "Preparando negocio…" : "Crear negocio"}
          </button>
        </div>
      </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function CampoNegocio({ label, icon: Icon, optional = false, children }: { label: string; icon: typeof Building2; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-sm font-semibold text-wa-text dark:text-wa-text-dark">
        {label}
        {optional && <span className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">Opcional</span>}
      </span>
      <span className="flex overflow-hidden rounded-xl border border-wa-border bg-gray-50/70 transition focus-within:border-wa-primary focus-within:bg-white focus-within:ring-4 focus-within:ring-wa-primary/10 dark:border-white/10 dark:bg-[#0b0e18] dark:focus-within:border-wa-primary dark:focus-within:bg-[#0b0e18]">
        <span className="flex w-11 shrink-0 items-center justify-center border-r border-wa-border text-wa-muted dark:border-white/10 dark:text-wa-muted-dark"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        {children}
      </span>
    </label>
  );
}

function Dominios({ organizacion }: { organizacion: Organization }) {
  const queryClient = useQueryClient();
  const [hostname, setHostname] = useState("");
  const campoId = useId();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ORGANIZACIONES });

  const agregar = useMutation({
    mutationFn: async () => {
      await client.post(`/api/platform/organizations/${organizacion.id}/domains`, {
        hostname,
      });
    },
    onSuccess: () => {
      setHostname("");
      refrescar();
    },
  });

  const quitar = useMutation({
    mutationFn: async (valor: string) => {
      await client.delete(
        `/api/platform/organizations/${organizacion.id}/domains/${encodeURIComponent(valor)}`,
      );
    },
    onSuccess: refrescar,
  });

  return (
    <div className="mt-4 border-t border-wa-border pt-4 dark:border-wa-border-dark">
      <div className="mb-3 flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-wa-text dark:text-white">Dominios</h4>
        <span className="rounded-full bg-wa-field px-2 py-0.5 text-xs font-semibold text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
          {organizacion.domains.length}
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {organizacion.domains.map((domain) => (
          <li
            key={domain.id}
            className="flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-wa-border bg-wa-field px-3 py-1 text-sm font-medium text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${domain.is_primary ? "bg-emerald-500" : "bg-gray-400"}`} aria-hidden="true" />
            <span className="min-w-0 break-all">{domain.hostname}</span>
            {domain.is_primary ? (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Principal</span>
            ) : (
              <button
                type="button"
                onClick={() => quitar.mutate(domain.hostname)}
                disabled={quitar.isPending}
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-wa-muted transition hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:opacity-50 dark:text-wa-muted-dark dark:hover:text-red-300"
                aria-label={`Quitar ${domain.hostname}`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(evento) => {
          evento.preventDefault();
          agregar.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={campoId} className="mb-1.5 block text-sm font-medium text-wa-text dark:text-wa-text-dark">Nuevo dominio</label>
          <Input id={campoId} className="h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark" value={hostname} onChange={(evento) => setHostname(evento.target.value)} placeholder="nuevo-dominio.com" required aria-invalid={agregar.isError} />
        </div>
        <button
          type="submit"
          disabled={!hostname.trim() || agregar.isPending}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-wa-border px-3.5 text-sm font-semibold text-wa-text transition hover:border-wa-primary/40 hover:bg-wa-primary/5 hover:text-wa-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:text-wa-primary"
        >
          {agregar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          Añadir dominio
        </button>
      </form>

      {(agregar.isError || quitar.isError) && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-300">
          {mensajeDeError(agregar.error ?? quitar.error)}
        </p>
      )}
    </div>
  );
}

function Negocio({ organizacion }: { organizacion: Organization }) {
  const queryClient = useQueryClient();
  const suspendido = organizacion.status === "suspended";

  const cambiarEstado = useMutation({
    mutationFn: async () => {
      const accion = suspendido ? "activate" : "suspend";
      await client.post(`/api/platform/organizations/${organizacion.id}/${accion}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ORGANIZACIONES }),
  });

  const colorEstado = organizacion.status === "active"
    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/15 dark:text-emerald-300"
    : suspendido
      ? "bg-amber-500/10 text-amber-700 ring-amber-500/15 dark:text-amber-300"
      : "bg-gray-500/10 text-gray-600 ring-gray-500/15 dark:text-gray-300";
  const inicial = organizacion.name.trim().charAt(0).toUpperCase() || "N";
  const botonEstado = (
    <button
      type="button"
      onClick={suspendido ? () => cambiarEstado.mutate() : undefined}
      disabled={cambiarEstado.isPending}
      className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-wait disabled:opacity-50 ${suspendido ? "border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300" : "border-wa-border text-wa-muted hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-700 dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:text-amber-300"}`}
    >
      {cambiarEstado.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : suspendido ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
      {suspendido ? "Reactivar" : "Suspender"}
    </button>
  );

  return (
    <li className="rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-sm font-bold text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary">
            {inicial}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-base font-bold text-wa-text dark:text-white">{organizacion.name}</h3>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${colorEstado}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${organizacion.status === "active" ? "bg-emerald-500" : suspendido ? "bg-amber-500" : "bg-gray-400"}`} aria-hidden="true" />
                {organizacion.status === "active" ? "Activo" : suspendido ? "Suspendido" : organizacion.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">{organizacion.domains.length} {organizacion.domains.length === 1 ? "dominio configurado" : "dominios configurados"}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {!organizacion.up_to_date && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
              title={`Revisión ${organizacion.revision ?? "desconocida"} (${organizacion.migration_status ?? "sin registro"})`}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Pendiente de actualización
            </span>
          )}
          {suspendido ? botonEstado : <ConfirmDialog title={`Suspender ${organizacion.name}`} description="Se cerrarán las sesiones activas y el negocio dejará de estar disponible hasta que lo reactives." confirmLabel="Suspender negocio" onConfirm={() => cambiarEstado.mutate()} disabled={cambiarEstado.isPending}>{botonEstado}</ConfirmDialog>}
        </div>
      </div>

      {cambiarEstado.isError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600 dark:text-red-300">{mensajeDeError(cambiarEstado.error)}</p>
      )}

      <Dominios organizacion={organizacion} />
      <details className="mt-4 border-t border-wa-border pt-3 text-sm dark:border-wa-border-dark">
        <summary className="w-fit cursor-pointer rounded text-wa-muted hover:text-wa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:text-wa-muted-dark dark:hover:text-wa-text-dark">Datos técnicos</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <div className="min-w-0"><dt className="font-semibold text-wa-muted dark:text-wa-muted-dark">Esquema</dt><dd className="break-all font-mono text-wa-text dark:text-wa-text-dark">{organizacion.schema_name}</dd></div>
          {organizacion.storage_prefix && <div className="min-w-0"><dt className="font-semibold text-wa-muted dark:text-wa-muted-dark">Almacenamiento</dt><dd className="break-all font-mono text-wa-text dark:text-wa-text-dark">tenants/{organizacion.storage_prefix}/</dd></div>}
          <div className="min-w-0"><dt className="font-semibold text-wa-muted dark:text-wa-muted-dark">Revisión</dt><dd className="break-all font-mono text-wa-text dark:text-wa-text-dark">{organizacion.revision ?? "Desconocida"}</dd></div>
          <div className="min-w-0"><dt className="font-semibold text-wa-muted dark:text-wa-muted-dark">Migración</dt><dd className="break-all font-mono text-wa-text dark:text-wa-text-dark">{organizacion.migration_status ?? "Sin registro"}</dd></div>
        </dl>
      </details>
    </li>
  );
}

function Panel({ operador, onSalir }: { operador: OperadorActual; onSalir: () => void }) {
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const [busqueda, setBusqueda] = useState("");
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ORGANIZACIONES });

  const negocios = useQuery({
    queryKey: ORGANIZACIONES,
    queryFn: async () => {
      const { data } = await client.get<{ head: string; items: Organization[] }>(
        "/api/platform/organizations",
      );
      return data;
    },
  });

  const salir = useMutation({
    mutationFn: async () => {
      await client.post("/api/platform/auth/logout");
    },
    onSuccess: onSalir,
  });

  const organizaciones = negocios.data?.items ?? [];
  const activas = organizaciones.filter((organizacion) => organizacion.status === "active").length;
  const suspendidas = organizaciones.filter((organizacion) => organizacion.status === "suspended").length;
  const pendientes = organizaciones.filter((organizacion) => !organizacion.up_to_date).length;
  const visibles = organizaciones.filter((organizacion) =>
    `${organizacion.name} ${organizacion.domains.map((dominio) => dominio.hostname).join(" ")}`
      .toLocaleLowerCase().includes(busqueda.trim().toLocaleLowerCase()),
  );

  return (
    <main className="h-full overflow-x-hidden overflow-y-auto bg-wa-app text-wa-text dark:bg-wa-app-dark dark:text-wa-text-dark">
      <header className="border-b border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="mx-auto flex min-h-16 max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <MarcaPlataforma />
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2.5 border-r border-wa-border pr-4 sm:flex dark:border-wa-border-dark">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary"><UserRound className="h-3.5 w-3.5" aria-hidden="true" /></span>
              <span className="max-w-40 truncate text-xs font-semibold text-wa-text dark:text-white">{operador.name}</span>
            </div>
            <button type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Activar modo claro" : "Activar modo oscuro"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-wa-border bg-white text-wa-muted transition hover:text-wa-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:text-wa-primary">
              {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => salir.mutate()} disabled={salir.isPending} aria-label="Cerrar sesión" className="inline-flex h-10 items-center gap-2 rounded-lg border border-wa-border bg-white px-3 text-sm font-semibold text-wa-muted transition hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:opacity-50 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:text-red-300">
              {salir.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
              <span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.03em] text-wa-text dark:text-white">Negocios</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
              Administra el acceso y los dominios de cada negocio.
            </p>
          </div>
          <NuevoNegocio onCreado={refrescar} />
        </section>

        <section className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-wa-border bg-white sm:grid-cols-4 dark:border-wa-border-dark dark:bg-wa-panel-dark" aria-label="Resumen de la plataforma">
          <Metrica label="Total" value={negocios.isLoading ? "—" : organizaciones.length} />
          <Metrica label="Activos" value={negocios.isLoading ? "—" : activas} />
          <Metrica label="Suspendidos" value={negocios.isLoading ? "—" : suspendidas} />
          <Metrica label="Por actualizar" value={negocios.isLoading ? "—" : pendientes} />
        </section>

        <section className="mt-8">
          <div className="flex flex-col gap-4 border-b border-wa-border pb-4 sm:flex-row sm:items-end sm:justify-between dark:border-wa-border-dark">
            <div>
              <h2 className="text-lg font-bold text-wa-text dark:text-white">Todos los negocios</h2>
              <p aria-live="polite" className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">{negocios.isLoading ? "Cargando lista…" : busqueda.trim() ? `${visibles.length} de ${organizaciones.length} negocios` : `${organizaciones.length} ${organizaciones.length === 1 ? "negocio" : "negocios"}`}</p>
            </div>
            {organizaciones.length > 0 && <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" /><Input aria-label="Buscar negocio o dominio" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Buscar negocio o dominio" className="h-10 border-wa-border bg-white pl-9 dark:border-wa-border-dark dark:bg-wa-head-dark" /></div>}
          </div>

          {negocios.isLoading && (
            <div role="status" className="mt-5 space-y-3"><div className="h-28 animate-pulse rounded-xl bg-wa-field motion-reduce:animate-none dark:bg-wa-head-dark" /><div className="h-28 animate-pulse rounded-xl bg-wa-field motion-reduce:animate-none dark:bg-wa-head-dark" /><span className="sr-only">Cargando negocios…</span></div>
          )}
          {negocios.isError && <div className="mt-6 space-y-3"><AvisoError mensaje={mensajeDeError(negocios.error)} /><Button variant="secondary" onClick={refrescar}>Volver a intentar</Button></div>}

          <ul className="mt-5 grid gap-3">
            {visibles.map((organizacion) => <Negocio key={organizacion.id} organizacion={organizacion} />)}
          </ul>

          {!negocios.isLoading && !negocios.isError && organizaciones.length > 0 && visibles.length === 0 && <div className="mt-5 rounded-xl border border-dashed border-wa-border p-8 text-center dark:border-wa-border-dark"><p className="text-sm text-wa-muted dark:text-wa-muted-dark">No hay negocios que coincidan con la búsqueda.</p><Button variant="secondary" className="mt-3" onClick={() => setBusqueda("")}>Limpiar búsqueda</Button></div>}

          {!negocios.isLoading && !negocios.isError && organizaciones.length === 0 && (
            <div className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-wa-border bg-white px-6 py-12 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary"><Building2 className="h-6 w-6" aria-hidden="true" /></span>
              <h3 className="mt-4 text-base font-bold text-wa-text dark:text-white">Aún no hay negocios</h3>
              <p className="mt-1 max-w-sm text-sm text-wa-muted dark:text-wa-muted-dark">Crea el primero para preparar su esquema, dominio y cuenta administradora.</p>
            </div>
          )}
          {negocios.data?.head && <p className="mt-6 text-xs text-wa-muted dark:text-wa-muted-dark">Revisión de plataforma: <span className="font-mono">{negocios.data.head}</span></p>}
        </section>
      </div>
    </main>
  );
}

function Metrica({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border-r border-b border-wa-border px-4 py-4 last:border-r-0 [&:nth-child(2)]:border-r-0 sm:border-b-0 sm:[&:nth-child(2)]:border-r dark:border-wa-border-dark">
      <p className="text-2xl font-bold leading-none text-wa-text dark:text-white">{value}</p>
      <p className="mt-1.5 text-sm text-wa-muted dark:text-wa-muted-dark">{label}</p>
    </div>
  );
}

export function PlatformApp() {
  const queryClient = useQueryClient();
  const sesion = useQuery({
    queryKey: ["platform", "me"],
    queryFn: async () => {
      try {
        const { data } = await client.get<OperadorActual>("/api/platform/auth/me");
        return data;
      } catch (error) {
        // 401 = todavía no entró. 404 = el panel no vive en este dominio, que
        // es la respuesta esperada desde el CRM de un negocio.
        if (axios.isAxiosError(error) && [401, 404].includes(error.response?.status ?? 0)) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });

  const recargarSesion = () =>
    queryClient.invalidateQueries({ queryKey: ["platform", "me"] });

  if (sesion.isLoading) {
    return (
      <div role="status" className="flex h-full items-center justify-center bg-wa-app text-wa-muted dark:bg-wa-app-dark dark:text-wa-muted-dark">
        Cargando panel…
      </div>
    );
  }
  if (sesion.isError) {
    return <main className="flex h-full items-center justify-center bg-wa-app p-4 dark:bg-wa-app-dark"><div className="w-full max-w-md space-y-4"><AvisoError mensaje={mensajeDeError(sesion.error)} /><Button variant="secondary" onClick={recargarSesion}>Volver a intentar</Button></div></main>;
  }
  if (!sesion.data) {
    return <Login onEntrar={recargarSesion} />;
  }
  return <Panel operador={sesion.data} onSalir={recargarSesion} />;
}
