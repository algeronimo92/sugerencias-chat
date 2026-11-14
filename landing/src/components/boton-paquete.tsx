"use client";

import type { ReactNode } from "react";
import type { IdPaquete } from "@/paquetes";

/** Evento con el que una tarjeta le dice al formulario qué paquete eligió. */
export const EVENTO_PAQUETE = "cliniventas:paquete";

/**
 * Botón de una tarjeta de paquete. Sigue siendo un enlace a #acceso (sin
 * JavaScript igual lleva al formulario) y además deja el paquete elegido
 * marcado allí, para que nadie tenga que volver a elegirlo.
 */
export function BotonPaquete({
  paquete, children, destacado = false,
}: { paquete: IdPaquete; children: ReactNode; destacado?: boolean }) {
  const estilos = destacado
    ? "bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-active"
    : "border border-border-strong bg-surface text-text hover:bg-surface-alt";
  return (
    <a
      href="#acceso"
      onClick={() => window.dispatchEvent(new CustomEvent<IdPaquete>(EVENTO_PAQUETE, { detail: paquete }))}
      className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-body-sm font-semibold transition-colors duration-[var(--duration-rapida)] ease-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${estilos}`}
    >
      {children}
    </a>
  );
}
