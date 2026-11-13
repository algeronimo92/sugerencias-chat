import type { ReactNode } from "react";

export function Seccion({
  id, children, className = "",
}: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`px-5 py-16 sm:py-24 ${className}`}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function Cejilla({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-eyebrow text-accent-strong uppercase">{children}</p>
  );
}

export function Boton({
  href, children, variante = "primario", className = "",
}: {
  href: string; children: ReactNode;
  variante?: "primario" | "secundario"; className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-body-sm font-semibold transition-colors duration-[var(--duration-rapida)] ease-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  const estilos = {
    primario: "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-active",
    secundario:
      "border border-border-strong bg-surface text-text hover:bg-surface-alt",
  }[variante];
  return (
    <a href={href} className={`${base} ${estilos} ${className}`}>
      {children}
    </a>
  );
}

export function Tarjeta({
  titulo, children, icono,
}: { titulo: string; children: ReactNode; icono: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-xs">
      <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent-strong">
        {icono}
      </span>
      {/* Los titulos se mantienen a UNA linea a proposito: asi los parrafos
          arrancan a la misma altura en toda la fila sin reservar espacio. */}
      <h3 className="text-h4 mb-1.5">{titulo}</h3>
      <p className="text-body-sm text-text-muted">{children}</p>
    </div>
  );
}
