import { MarcaSimbolo } from "./marca";

/**
 * Maqueta de la bandeja de CliniVentas, reconstruida en HTML.
 * Reproduce la interfaz real del producto (barra verde, lista de leads,
 * fondo crema, burbujas y palomitas) con datos ficticios: ningun dato
 * de paciente real sale a la web. Ver docs/direccion-arte.md, seccion 7.
 */

function Palomita({ leida = false }: { leida?: boolean }) {
  return (
    <svg
      viewBox="0 0 18 12"
      aria-hidden="true"
      className={`inline-block h-3 w-[18px] shrink-0 ${leida ? "text-tick-read" : "text-tick-idle"}`}
    >
      <path
        d="M1 6.4 4.2 9.6 10.6 2.2M6.8 6.9 8.9 9.6 15.4 2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const LEADS = [
  { inicial: "V", nombre: "Valeria Ríos", hora: "01:28 p. m.", texto: "Video", activo: true },
  { inicial: "C", nombre: "Camila Torres", hora: "01:24 p. m.", texto: "Después de 3 sesiones, cam…" },
  { inicial: "D", nombre: "Daniela Ocampo", hora: "01:22 p. m.", texto: "¿Queda cerca del centro?" },
  { inicial: "M", nombre: "Martín Salas", hora: "01:21 p. m.", texto: "Perfecto, ahí estaré 🙌" },
  { inicial: "P", nombre: "Paula Herrera", hora: "01:20 p. m.", texto: "Le gustaría separar una cita…", vencido: true },
  { inicial: "R", nombre: "Rodrigo Núñez", hora: "01:18 p. m.", texto: "Gracias, lo converso en casa" },
];

export function ChatMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-xl">
      {/* Barra superior del producto */}
      <div className="flex items-center gap-2 bg-accent px-3 py-2.5 text-text-inverse sm:gap-4 sm:px-4">
        <span className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
          <MarcaSimbolo className="h-6 w-6" />
          CliniVentas
        </span>
        <nav className="hidden items-center gap-1 text-body-sm md:flex" aria-hidden="true">
          <span className="rounded-md bg-white/18 px-2.5 py-1 font-medium">Chats</span>
          <span className="px-2.5 py-1 text-white/75">Kanban</span>
          <span className="px-2.5 py-1 text-white/75">Tareas</span>
          <span className="px-2.5 py-1 text-white/75">Nueva cita</span>
          <span className="px-2.5 py-1 text-white/75">Dashboard</span>
        </nav>
      </div>

      <div className="flex h-[532px] sm:h-[496px]">
        {/* Lista de leads */}
        <aside className="hidden w-[38%] max-w-[264px] shrink-0 flex-col border-r border-border bg-surface sm:flex">
          <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
            <span className="font-display text-[15px] font-semibold">Leads</span>
            <span className="text-micro text-text-subtle">2.529</span>
          </div>
          <div className="px-3 pb-2.5">
            <div className="flex items-center gap-2 rounded-full bg-surface-alt px-3 py-1.5 text-caption text-text-subtle">
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Buscar lead…
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-hidden">
            {LEADS.map((l) => (
              <li
                key={l.nombre}
                className={`flex items-start gap-2.5 border-b border-border/60 px-3 py-2.5 ${
                  l.activo ? "bg-accent-soft" : ""
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sage text-caption font-semibold text-white">
                  {l.inicial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-caption font-semibold">{l.nombre}</span>
                    <span className="shrink-0 text-micro text-text-subtle">{l.hora}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1">
                    <span className="truncate text-micro text-text-muted">{l.texto}</span>
                    {l.vencido && (
                      <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3 w-3 shrink-0 text-danger">
                        <rect x="2.6" y="6" width="8.8" height="6" rx="1.4" fill="currentColor" />
                        <path d="M4.7 6V4.4a2.3 2.3 0 0 1 4.6 0V6" fill="none" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </aside>

        {/* Conversación */}
        <div className="flex min-w-0 flex-1 flex-col bg-bg">
          <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-sage text-caption font-semibold text-white">
              V
            </span>
            <span className="min-w-0">
              <span className="block truncate text-caption font-semibold">Valeria Ríos</span>
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-px text-micro font-medium text-accent-strong">
                <svg viewBox="0 0 14 14" aria-hidden="true" className="h-2.5 w-2.5">
                  <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M7 4.2V7l1.9 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Quedan 23h 34m para responder
              </span>
            </span>
          </header>

          <div className="patron-conversacion min-h-0 flex-1 space-y-2 overflow-hidden px-3 py-3.5 sm:px-5">
            <p className="mx-auto w-fit rounded-full bg-surface px-2.5 py-0.5 text-micro text-text-subtle shadow-xs">
              Hoy
            </p>

            <div className="flex justify-start">
              <p className="max-w-[76%] rounded-bubble rounded-bl-[var(--radius-bubble-tail)] bg-bubble-in px-3 py-2 text-body-sm text-bubble-in-text shadow-bubble">
                Hola, vi el Hollywood Peel en Instagram. ¿Cuánto cuesta la sesión? 😊
                <span className="mt-1 block text-right text-micro text-text-subtle">01:24 p. m.</span>
              </p>
            </div>

            <div className="flex justify-end">
              <p className="max-w-[76%] rounded-bubble rounded-br-[var(--radius-bubble-tail)] bg-bubble-out px-3 py-2 text-body-sm text-bubble-out-text shadow-bubble">
                ¡Hola Valeria! Te cuento: la sesión sale S/ 250 y el paquete de 3 queda en S/ 600 ✨
                <span className="mt-1 flex items-center justify-end gap-1 text-micro text-text-subtle">
                  01:26 p. m. <Palomita leida />
                </span>
              </p>
            </div>

            {/* Nota interna: lo que el cliente nunca ve */}
            <div className="flex justify-end">
              <p className="max-w-[80%] rounded-lg border border-warning-solid/45 border-l-[3px] border-l-warning-solid bg-warning-soft px-3 py-2 text-body-sm text-text">
                <span className="mb-0.5 flex items-center gap-1 text-micro font-semibold tracking-wide text-warning uppercase">
                  <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3 w-3">
                    <path d="M2.5 3.4h9v7.2h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M4.6 6h4.8M4.6 8.2h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  Nota interna · no la ve el cliente
                </span>
                Vino por la campaña de agosto. Preguntó por financiamiento.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border bg-surface px-3 py-2.5">
            <span className="flex-1 truncate rounded-full bg-surface-alt px-3.5 py-2 text-caption text-text-subtle">
              Escribe un mensaje…
            </span>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-contrast">
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
                <path d="m3 10 14-6-5.2 14-2.4-5.8L3 10z" fill="currentColor" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
