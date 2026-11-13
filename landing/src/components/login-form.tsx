"use client";

import { useState } from "react";
import Link from "next/link";
import { MarcaTeja } from "@/components/marca";
import { resolverInquilino } from "@/inquilinos";

/**
 * Formulario de entrada.
 *
 * NO PIDE CONTRASENA, Y ES A PROPOSITO. Esta pagina es HTML estatico: no hay
 * servidor detras, asi que cualquier comprobacion de credenciales viajaria
 * dentro del JavaScript que se descarga el visitante — o sea, no seria una
 * comprobacion. Lo que hace es mirar el dominio del correo y llevar al usuario
 * a la instalacion de su clinica, donde el login si es real. Es el mismo flujo
 * en dos pasos de Slack o Notion: primero se resuelve a que cuenta perteneces,
 * la clave se comprueba ya dentro.
 *
 * Si alguien anade aqui un campo de contrasena "para que parezca un login
 * completo", estara ensenando al equipo a teclear su clave en una pantalla que
 * no la valida — que es justo el habito del que vive el phishing. No lo hagas.
 */

const CLASE_CAMPO =
  "w-full rounded-lg border border-border-field bg-surface px-3.5 py-2.5 text-body-sm placeholder:text-text-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

export function FormularioLogin() {
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);

  function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const destino = resolverInquilino(correo);

    if (!destino) {
      setError(
        "No reconocemos ese correo. Revisa si lo escribiste bien o usa el que te dio tu clínica.",
      );
      return;
    }

    setError(null);
    setSaliendo(true);
    window.location.assign(destino.url);
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
          <MarcaTeja />
          CliniVentas
        </Link>
        <h1 className="text-h2 mt-6">Entra a tu cuenta</h1>
        <p className="mt-2.5 text-body-sm text-text-muted">
          Escribe el correo de tu clínica y te llevamos a tu panel.
        </p>
      </div>

      <form onSubmit={entrar} noValidate className="rounded-xl border border-border bg-surface p-6 shadow-xs sm:p-7">
        <div className="space-y-4">
          <div>
            <label htmlFor="correo" className="mb-1.5 block text-caption font-medium">
              Correo
            </label>
            <input
              id="correo" name="correo" type="email" required autoFocus
              /* `username`, no `email`: es el identificador de un login en dos
                 pasos y asi los gestores de contrasenas lo reconocen. */
              autoComplete="username" placeholder="tu@clinica.com"
              value={correo}
              onChange={(e) => { setCorreo(e.target.value); setError(null); }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "error-login" : undefined}
              className={CLASE_CAMPO}
            />
          </div>

        </div>

        {error && (
          <p id="error-login" role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-body-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saliendo}
          className="mt-6 w-full rounded-full bg-accent px-6 py-3 text-body-sm font-semibold text-accent-contrast transition-colors duration-[var(--duration-rapida)] ease-suave hover:bg-accent-hover active:bg-accent-active disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {saliendo ? "Llevándote a tu panel…" : "Continuar"}
        </button>
      </form>

      <p className="mt-6 text-center text-body-sm text-text-muted">
        ¿Todavía no tienes cuenta?{" "}
        <Link href="/#acceso" className="font-semibold text-accent-strong underline underline-offset-2">
          Solicita tu acceso
        </Link>
      </p>
    </div>
  );
}
