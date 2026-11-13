import type { Metadata } from "next";
import Link from "next/link";
import { Boton } from "@/components/secciones";

export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false, follow: true },
};

/**
 * nginx.conf apunta error_page 404 a /404.html, que es lo que genera este
 * archivo. Sin el, se serviria la pagina por defecto de Next —
 * "404: This page could not be found", en ingles y sin la marca.
 */
export default function NoEncontrada() {
  return (
    <main className="flex flex-1 items-center px-5 py-24">
      <div className="columna-lectura text-center">
        <p className="mb-3 text-eyebrow text-accent-strong uppercase">Error 404</p>
        <h1 className="text-display-2">Esta página no existe</h1>
        <p className="text-lead mt-5 text-text-muted">
          Puede que el enlace esté mal escrito o que la página haya cambiado de
          sitio. Desde la portada llegas a todo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Boton href="/">Ir a la portada</Boton>
          <Boton href="/#acceso" variante="secundario">Solicita tu acceso</Boton>
        </div>
        <p className="mt-8 text-body-sm text-text-muted">
          ¿Buscabas la <Link href="/privacidad" className="text-accent-strong underline underline-offset-2">política de privacidad</Link>{" "}
          o la <Link href="/tratamiento-de-datos" className="text-accent-strong underline underline-offset-2">política de tratamiento de datos</Link>?
        </p>
      </div>
    </main>
  );
}
