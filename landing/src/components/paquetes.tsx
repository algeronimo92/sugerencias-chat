import { BotonPaquete } from "@/components/boton-paquete";
import { Cejilla, Seccion } from "@/components/secciones";
import { FUNCIONES, PAQUETES, type Celda } from "@/paquetes";

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-accent ${className}`}>
      <path d="m3.4 8.3 2.9 2.9 6.3-6.4" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ValorCelda({ valor }: { valor: Celda }) {
  if (valor === true) {
    return (
      <>
        <Check className="mx-auto h-4 w-4" />
        <span className="sr-only">Incluido</span>
      </>
    );
  }
  if (valor === false) {
    return (
      <>
        <span aria-hidden="true" className="text-text-subtle">—</span>
        <span className="sr-only">No incluido</span>
      </>
    );
  }
  // En el celular cada columna mide unos 60 px: el texto va más chico y
  // puede cortarse con guion antes que montarse sobre la columna de al lado.
  return <span className="block text-micro font-medium break-words hyphens-auto text-text sm:text-caption">{valor}</span>;
}

export function SeccionPaquetes() {
  return (
    <Seccion id="precios" className="border-y border-border bg-surface">
      <div className="columna-lectura text-center">
        <Cejilla>Paquetes</Cejilla>
        <h2 className="text-h1">Elige según el tamaño de tu equipo</h2>
        <p className="text-lead mt-5 text-text-muted">
          Todos traen la bandeja, el embudo, la agenda y el panel completos. Subes
          de paquete cuando crece tu equipo, cuando quieres automatizar o cuando
          inviertes en anuncios. Nunca pagas por cantidad de pacientes ni de
          mensajes.
        </p>
      </div>

      {/* subgrid: las filas (insignia, nombre, descripcion, personas, boton,
          lista) se alinean entre las tres columnas aunque el texto de cada
          paquete tenga distinto largo. */}
      <div className="mt-12 grid gap-6 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_auto_auto_1fr]">
        {PAQUETES.map((p) => (
          <div
            key={p.id}
            className={`rounded-xl border bg-bg p-7 lg:row-span-6 lg:grid lg:grid-rows-subgrid ${
              p.destacado ? "border-accent shadow-lg ring-1 ring-accent" : "border-border shadow-xs"
            }`}
          >
            <div className={p.destacado ? "mb-4 lg:mb-0" : "hidden lg:block"}>
              {p.destacado && (
                <span className="inline-block rounded-full bg-accent px-3 py-1 text-micro font-semibold tracking-wide text-accent-contrast uppercase">
                  El que eligen la mayoría
                </span>
              )}
            </div>
            <h3 className="text-h3">{p.nombre}</h3>
            <p className="mt-1.5 text-body-sm text-text-muted">{p.para}</p>
            <p className="mt-5 font-display text-[20px] font-semibold tracking-tight">{p.personas}</p>
            <BotonPaquete paquete={p.id} destacado={p.destacado}>
              Quiero {p.nombre}
            </BotonPaquete>
            <ul className="mt-7 space-y-2.5 border-t border-border pt-6">
              {p.claves.map((c) => (
                <li key={c} className="flex gap-2.5 text-body-sm">
                  <Check className="mt-1" />
                  <span className="text-text-muted">{c}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-body-sm text-text-muted">
        El precio depende de tu paquete y de cómo factures. Déjanos tus datos y te
        enviamos la cotización por WhatsApp.
      </p>

      {/* ------------------------------------------------ TABLA COMPARATIVA */}
      <div id="comparar" className="mt-16">
        <h3 className="text-h2 text-center">Qué incluye cada paquete</h3>
        <div className="mx-auto mt-8 max-w-4xl overflow-hidden rounded-xl border border-border bg-bg">
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">Funciones incluidas en Básico, Esencial y Profesional</caption>
            <colgroup>
              {/* En el celular la columna de funciones cede ancho: con 43%
                  los nombres largos de los paquetes se partían a mitad de
                  palabra y el encabezado dejaba de verse alineado. */}
              <col className="w-[34%] sm:w-[46%]" />
              <col /><col /><col />
            </colgroup>
            <thead>
              <tr className="border-b border-border bg-surface">
                <th scope="col" className="px-2.5 py-3 text-caption font-medium text-text-muted sm:px-5">Función</th>
                {PAQUETES.map((p) => (
                  <th key={p.id} scope="col"
                    className={`px-0.5 py-3 text-center text-micro font-semibold whitespace-nowrap sm:px-3 sm:text-body-sm ${p.destacado ? "text-accent-strong" : ""}`}>
                    {p.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            {FUNCIONES.map((grupo) => (
              <tbody key={grupo.titulo}>
                <tr>
                  <th scope="colgroup" colSpan={4}
                    className="bg-surface-alt px-3 pt-4 pb-2 text-eyebrow text-accent-strong uppercase sm:px-5">
                    {grupo.titulo}
                  </th>
                </tr>
                {grupo.funciones.map((f) => (
                  <tr key={f.nombre} className="border-t border-border">
                    <th scope="row" className="px-2.5 py-3 align-top font-normal sm:px-5">
                      <span className="block text-caption text-text sm:text-body-sm">{f.nombre}</span>
                      {f.detalle && <span className="mt-0.5 block text-caption text-text-subtle">{f.detalle}</span>}
                    </th>
                    {PAQUETES.map((p) => (
                      <td key={p.id} className="px-1 py-3 text-center align-top sm:px-3">
                        <ValorCelda valor={f.en[p.id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="mx-auto mt-6 max-w-4xl text-center text-caption text-text-subtle">
          Sin permanencia: cancelas cuando quieras y te llevas tus datos. Garantía
          de 30 días: si no te sirve, te devolvemos el dinero.
        </p>
      </div>
    </Seccion>
  );
}
