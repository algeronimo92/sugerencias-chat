import Link from "next/link";
import { BotonTema } from "@/components/tema";
import { Boton } from "@/components/secciones";
import { MarcaTeja } from "@/components/marca";
import { CTA_TEXTO } from "@/textos";

/**
 * Cabecera y pie viven en el layout, no en la portada: las paginas legales
 * necesitan la misma navegacion y no tiene sentido duplicarla.
 * Por eso los enlaces de ancla son absolutos (`/#precios`, no `#precios`):
 * desde /privacidad un ancla relativa no lleva a ningun sitio.
 */
export function Cabecera() {
  return (
    <header className="vidrio sticky top-0 z-50 border-b border-border">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" className="flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
          <MarcaTeja />
          CliniVentas
        </Link>
        <nav className="hidden items-center gap-7 text-body-sm text-text-muted md:flex">
          <Link href="/#producto" className="hover:text-text">Producto</Link>
          <Link href="/#automatizacion" className="hover:text-text">Automatización</Link>
          <Link href="/#precios" className="hover:text-text">Precios</Link>
          <Link href="/#preguntas" className="hover:text-text">Preguntas</Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="hidden text-body-sm text-text-muted hover:text-text sm:block"
          >
            Entrar
          </Link>
          <BotonTema />
          <Boton href="/#acceso" className="!px-5 !py-2">{CTA_TEXTO}</Boton>
        </div>
      </div>
    </header>
  );
}

export function Pie() {
  return (
    <footer className="border-t border-border bg-surface px-5 py-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <p className="flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
              <MarcaTeja />
              CliniVentas
            </p>
            <p className="mt-3 text-body-sm text-text-muted">
              El CRM de ventas para clínicas, spas y centros médicos que ya venden
              por WhatsApp.
            </p>
          </div>
          <nav className="flex flex-wrap gap-12 text-body-sm">
            <div>
              <p className="mb-3 text-caption font-semibold">Producto</p>
              <ul className="space-y-2 text-text-muted">
                <li><Link href="/#producto" className="hover:text-text">Bandeja compartida</Link></li>
                <li><Link href="/#automatizacion" className="hover:text-text">Automatizaciones</Link></li>
                <li><Link href="/#precios" className="hover:text-text">Precios</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-caption font-semibold">Empresa</p>
              <ul className="space-y-2 text-text-muted">
                <li><Link href="/#preguntas" className="hover:text-text">Preguntas</Link></li>
                <li><Link href="/#acceso" className="hover:text-text">Contacto</Link></li>
                <li><Link href="/login" className="hover:text-text">Entrar</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-caption font-semibold">Legal</p>
              <ul className="space-y-2 text-text-muted">
                <li><Link href="/privacidad" className="hover:text-text">Política de privacidad</Link></li>
                <li><Link href="/tratamiento-de-datos" className="hover:text-text">Tratamiento de datos</Link></li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="mt-10 border-t border-border pt-6">
          <p className="text-micro text-text-subtle">
            © {new Date().getFullYear()} CliniVentas. Todos los derechos reservados.
          </p>
          <p className="mt-2 max-w-3xl text-micro text-text-subtle">
            CliniVentas es un producto independiente y no está afiliado, patrocinado
            ni respaldado por WhatsApp LLC ni por Meta Platforms, Inc. WhatsApp es una
            marca registrada de sus respectivos titulares.
          </p>
        </div>
      </div>
    </footer>
  );
}
