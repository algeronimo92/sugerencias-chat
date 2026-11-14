"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BotonTema } from "@/components/tema";

const ENLACES = [
  ["/#producto", "Producto"],
  ["/#automatizacion", "Automatización"],
  ["/#precios", "Paquetes"],
  ["/#preguntas", "Preguntas"],
  ["/login", "Entrar a mi cuenta"],
] as const;

/**
 * Menú de la cabecera por debajo de 1024 px. Antes el celular no tenía cómo
 * llegar a las secciones ni a "Entrar", el botón de la cabecera se partía en
 * dos líneas pegado al borde, y en tablet (768 px) la navegación completa no
 * entraba y se salía 44 px por la derecha. Aquí van los enlaces y el cambio de
 * tema; en la cabecera quedan la marca, el botón de cotizar y este menú.
 */
export function MenuMovil() {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function cerrarConEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAbierto(false);
    }
    function cerrarAfuera(evento: PointerEvent) {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    }
    document.addEventListener("keydown", cerrarConEscape);
    document.addEventListener("pointerdown", cerrarAfuera);
    return () => {
      document.removeEventListener("keydown", cerrarConEscape);
      document.removeEventListener("pointerdown", cerrarAfuera);
    };
  }, [abierto]);

  return (
    <div ref={contenedor} className="lg:hidden">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="menu-movil"
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        onClick={() => setAbierto((actual) => !actual)}
        className="grid h-10 w-10 place-items-center rounded-full border border-border text-text-muted transition-colors duration-[var(--duration-rapida)] ease-suave hover:bg-surface-alt hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
          {abierto ? (
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {abierto && (
        <nav
          id="menu-movil"
          aria-label="Secciones"
          className="absolute inset-x-0 top-full border-b border-border bg-surface px-5 pt-2 pb-4 shadow-lg"
        >
          <ul>
            {ENLACES.map(([href, texto]) => (
              <li key={href}>
                <Link
                  href={href}
                  onClick={() => setAbierto(false)}
                  className="flex min-h-12 items-center border-b border-border text-body text-text hover:text-accent-strong"
                >
                  {texto}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between text-body-sm text-text-muted">
            Modo claro u oscuro
            <BotonTema />
          </div>
        </nav>
      )}
    </div>
  );
}
