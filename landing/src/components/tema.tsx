"use client";

/**
 * Interruptor de tema, sin estado de React a proposito.
 *
 * Se pintan los DOS iconos y es el CSS (la variante `dark`, que cubre tanto
 * prefers-color-scheme como el atributo data-theme) el que decide cual se ve.
 * Asi no hay desajuste de hidratacion, no hay parpadeo al cargar y el icono
 * nunca salta despues del primer pintado.
 */
export function BotonTema() {
  function alternar() {
    const raiz = document.documentElement;
    const actual =
      raiz.dataset.theme ??
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const siguiente = actual === "dark" ? "light" : "dark";
    raiz.dataset.theme = siguiente;
    try {
      localStorage.setItem("tema", siguiente);
    } catch {
      /* modo privado: el cambio vale solo para esta visita */
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label="Cambiar entre modo claro y oscuro"
      title="Cambiar tema"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-text-muted transition-colors duration-[var(--duration-rapida)] ease-suave hover:bg-surface-alt hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {/* Sol: visible en claro */}
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] dark:hidden">
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
        />
      </svg>
      {/* Luna: visible en oscuro */}
      <svg viewBox="0 0 24 24" aria-hidden="true" className="hidden h-[18px] w-[18px] dark:block">
        <path
          d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"
          fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
