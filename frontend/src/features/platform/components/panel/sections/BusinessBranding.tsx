import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '../../../../../shared/ui/Button'
import { Input } from '../../../../../shared/ui/Input'
import { fetchOrganizationBranding, removeOrganizationLogo, saveOrganizationBranding, uploadOrganizationLogo } from '../../../api'
import { platformKeys } from '../../../keys'
import type { MarcaGuardada, Organization } from '../../../types'
import { mensajeDeError } from '../errors'

// Mismo mínimo que valida el backend (services/branding.py): los botones del
// CRM llevan texto blanco sobre el color principal.
const CONTRASTE_MINIMO = 3;

function contrasteConBlanco(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const canales = [1, 3, 5].map((inicio) => {
    const valor = parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  });
  const luminancia = 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
  return 1.05 / (luminancia + 0.05);
}

interface ParteProps {
  organizacion: Organization
  marca: MarcaGuardada
}

function NombreYColor({ organizacion, marca }: ParteProps) {
  const formId = useId();
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(marca.display_name ?? "");
  const [color, setColor] = useState(marca.primary_color);

  // Lo guardado manda: el servidor normaliza el nombre y el color.
  useEffect(() => {
    setNombre(marca.display_name ?? "");
    setColor(marca.primary_color);
  }, [marca]);

  const guardar = useMutation({
    mutationFn: async () =>
      await saveOrganizationBranding(organizacion, nombre, color),
    onSuccess: (data) => queryClient.setQueryData(platformKeys.branding(organizacion.id), data),
  });

  const contraste = contrasteConBlanco(color);
  const colorValido = contraste !== null && contraste >= CONTRASTE_MINIMO;

  return (
    <form
      className="rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark"
      onSubmit={(evento) => {
        evento.preventDefault();
        guardar.mutate();
      }}
    >
      <h3 className="text-sm font-semibold text-wa-text dark:text-white">Nombre y color</h3>
      <p className="mt-1 text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">
        Se ven en el acceso, el encabezado y la app instalada del negocio, y son el pie por defecto de sus botones y listas de WhatsApp.
      </p>
      <label htmlFor={`${formId}-nombre`} className="mt-3 block text-xs font-semibold text-wa-text dark:text-wa-text-dark">
        Nombre visible
      </label>
      <Input
        id={`${formId}-nombre`}
        value={nombre}
        onChange={(evento) => setNombre(evento.target.value)}
        maxLength={60}
        placeholder={organizacion.name}
        className="mt-1.5 h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark"
      />
      <label htmlFor={`${formId}-color`} className="mt-3 block text-xs font-semibold text-wa-text dark:text-wa-text-dark">
        Color principal
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#00a884"}
          onChange={(evento) => setColor(evento.target.value)}
          aria-label="Elegir color principal"
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-wa-border bg-white p-1 dark:border-wa-border-dark dark:bg-wa-head-dark"
        />
        <Input
          id={`${formId}-color`}
          value={color}
          onChange={(evento) => setColor(evento.target.value.trim())}
          maxLength={7}
          aria-invalid={!colorValido}
          className="h-10 max-w-32 border-wa-border bg-white font-mono dark:border-wa-border-dark dark:bg-wa-head-dark"
        />
        <span
          className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-white"
          style={{ backgroundColor: contraste !== null ? color : "#667781" }}
          aria-hidden="true"
        >
          Botón
        </span>
      </div>
      <p className={`mt-2 text-xs ${colorValido ? "text-wa-muted dark:text-wa-muted-dark" : "text-red-600 dark:text-red-300"}`}>
        {contraste === null
          ? "Usa el formato #RRGGBB."
          : `Contraste con texto blanco: ${contraste.toFixed(1)}:1${colorValido ? "" : ` (mínimo ${CONTRASTE_MINIMO}:1, elige un tono más oscuro)`}`}
      </p>
      {guardar.isError && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{mensajeDeError(guardar.error)}</p>}
      <div className="mt-4 flex items-center justify-end gap-3">
        {guardar.isSuccess && <span className="text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">Guardado</span>}
        <Button type="submit" size="sm" disabled={guardar.isPending || !colorValido}>
          {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Guardar marca
        </Button>
      </div>
    </form>
  );
}

function LogoNegocio({ organizacion, marca }: ParteProps) {
  const queryClient = useQueryClient();
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const clave = platformKeys.branding(organizacion.id);

  const subirLogo = useMutation({
    mutationFn: async (archivo: File) =>
      await uploadOrganizationLogo(organizacion, archivo),
    onSuccess: (data) => queryClient.setQueryData(clave, data),
  });

  const quitarLogo = useMutation({
    mutationFn: async () =>
      await removeOrganizationLogo(organizacion),
    onSuccess: (data) => queryClient.setQueryData(clave, data),
  });

  const errorLogo =
    errorArchivo ??
    (subirLogo.isError ? mensajeDeError(subirLogo.error) : quitarLogo.isError ? mensajeDeError(quitarLogo.error) : null);

  return (
    <div className="rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <h3 className="text-sm font-semibold text-wa-text dark:text-white">Logo</h3>
      <p className="mt-1 text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">
        PNG, JPG o WEBP de hasta 2 MB. Se ajusta a un cuadrado y también es el ícono de la app instalada.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-wa-border bg-white dark:border-wa-border-dark">
          {marca.has_logo ? (
            <img
              src={`/api/platform/organizations/${organizacion.id}/branding/logo?v=${marca.version}`}
              alt={`Logo de ${marca.name}`}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-xs text-wa-muted">Sin logo</span>
          )}
        </span>
        <div className="flex flex-col gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-wa-border px-3 text-sm font-semibold text-wa-text transition hover:border-wa-primary/40 hover:bg-wa-primary/5 focus-within:ring-2 focus-within:ring-wa-primary dark:border-wa-border-dark dark:text-wa-text-dark">
            {subirLogo.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {marca.has_logo ? "Cambiar logo" : "Subir logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={subirLogo.isPending}
              onChange={(evento) => {
                const archivo = evento.target.files?.[0];
                evento.target.value = "";
                if (!archivo) return;
                if (archivo.size > 2 * 1024 * 1024) {
                  setErrorArchivo("El logo supera los 2 MB.");
                  return;
                }
                setErrorArchivo(null);
                subirLogo.mutate(archivo);
              }}
            />
          </label>
          {marca.has_logo && (
            <Button variant="ghost" size="sm" onClick={() => quitarLogo.mutate()} disabled={quitarLogo.isPending}>
              Quitar logo
            </Button>
          )}
        </div>
      </div>
      {errorLogo && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{errorLogo}</p>}
    </div>
  );
}

/**
 * Marca con la que el negocio ve su CRM (acceso, encabezado, app instalada y
 * pie por defecto de sus botones y listas de WhatsApp). La edita el operador.
 */
export function BusinessBranding({ organizacion }: { organizacion: Organization }) {
  const marca = useQuery({
    queryKey: platformKeys.branding(organizacion.id),
    queryFn: async () =>
      await fetchOrganizationBranding(organizacion),
  });

  if (marca.isLoading) return <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando marca…</p>;
  if (marca.isError) return <p role="alert" className="text-xs text-red-600 dark:text-red-300">{mensajeDeError(marca.error)}</p>;
  if (!marca.data) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <NombreYColor organizacion={organizacion} marca={marca.data} />
      <LogoNegocio organizacion={organizacion} marca={marca.data} />
    </div>
  );
}
