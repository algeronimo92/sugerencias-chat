import type { ReactNode } from "react";
import { ACTUALIZADO, EMPRESA, MARCO, SUBENCARGADOS_CRM, SUBENCARGADOS_WEB } from "@/datos-legales";

/**
 * Andamiaje de las paginas legales. Un texto legal es prosa larga, no una
 * retahila de tarjetas: va en columna de lectura, con numeracion visible para
 * poder citar un apartado por su numero ("segun el punto 7 de su politica").
 *
 * Los estilos de parrafo, lista y tabla se aplican con selectores de
 * descendiente (`[&_p]:...`) en vez de repetir clases en cada etiqueta: el
 * contenido queda como HTML limpio y se lee al editarlo.
 */

/**
 * Salvavidas: mientras queden corchetes sin rellenar en `datos-legales.ts`
 * la pagina lo dice en grande. Desaparece solo cuando se completan los datos,
 * asi que no hay forma de publicar una politica con `[RUC]` dentro sin verlo.
 */
function hayHuecos() {
  const valores = [
    ...Object.values(EMPRESA),
    ...Object.values(MARCO),
    ...[...SUBENCARGADOS_WEB, ...SUBENCARGADOS_CRM].flatMap((s) => Object.values(s)),
  ];
  return valores.some((v) => v.includes("["));
}

function AvisoBorrador() {
  if (!hayHuecos()) return null;
  return (
    <div className="mt-8 rounded-lg border border-warning-solid bg-warning-soft px-5 py-4">
      <p className="text-body-sm font-semibold text-text">
        Borrador sin completar
      </p>
      <p className="mt-1.5 text-body-sm text-text-muted">
        Este texto todavía tiene datos entre corchetes. Hay que rellenar
        <code className="mx-1 rounded bg-surface px-1 py-0.5 text-caption">src/datos-legales.ts</code>
        y someterlo a revisión legal antes de publicarlo. Este aviso desaparece solo.
      </p>
    </div>
  );
}

export function PaginaLegal({
  titulo, entradilla, children,
}: { titulo: string; entradilla: string; children: ReactNode }) {
  return (
    <main className="flex-1 px-5 py-14 sm:py-20">
      <div className="columna-lectura">
        <p className="mb-3 text-eyebrow text-accent-strong uppercase">Legal</p>
        <h1 className="text-display-2">{titulo}</h1>
        <p className="text-lead mt-5 text-text-muted">{entradilla}</p>
        <p className="mt-6 border-t border-border pt-5 text-caption text-text-subtle">
          Última actualización: {ACTUALIZADO}
        </p>
        <AvisoBorrador />
        {children}
      </div>
    </main>
  );
}

/**
 * `id` opcional para anclas que no deben cambiar al renumerar: la URL de
 * eliminacion de datos que se declara en el panel de Meta apunta a
 * /tratamiento-de-datos#eliminacion y tiene que seguir funcionando aunque
 * se inserte un apartado por delante.
 */
export function Apartado({
  n, titulo, id, children,
}: { n: number; titulo: string; id?: string; children: ReactNode }) {
  return (
    <section
      id={id ?? `apartado-${n}`}
      className="mt-12 scroll-mt-24 [&_a]:text-accent-strong [&_a]:underline [&_a]:underline-offset-2 [&_li]:text-text-muted [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:mt-4 [&_p]:text-body [&_p]:text-text-muted [&_strong]:font-semibold [&_strong]:text-text [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5"
    >
      <h2 className="text-h3">
        <span className="mr-2 text-text-subtle tabular-nums">{n}.</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Aviso enmarcado para lo que el lector no debe pasar por alto. */
export function Nota({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded-lg border border-border-strong border-l-[3px] border-l-accent bg-surface px-5 py-4 text-body-sm [&_p]:mt-0 [&_p+p]:mt-3 [&_p]:text-text-muted">
      {children}
    </div>
  );
}

/** Tabla sobria; en movil se desplaza sola en vez de romper la pagina. */
export function Tabla({
  cabeceras, filas,
}: { cabeceras: string[]; filas: string[][] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[520px] border-collapse text-body-sm">
        <thead>
          <tr className="bg-surface-alt text-left">
            {cabeceras.map((c) => (
              <th key={c} className="border-b border-border px-4 py-2.5 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.join()} className="border-b border-border/70 last:border-0">
              {fila.map((celda, i) => (
                <td key={i} className="px-4 py-2.5 align-top text-text-muted">{celda}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
