/**
 * Que clinica vive en que subdominio.
 *
 * /login no autentica: mira el correo, deduce a que clinica pertenece y manda
 * al visitante a SU instalacion, donde esta el login de verdad. Es el patron
 * de toda aplicacion multiempresa (Slack, Notion): primero se resuelve el
 * espacio de trabajo, la contrasena se comprueba ya dentro.
 *
 * Para dar de alta una clinica nueva basta con anadir una entrada aqui.
 * Ojo: la clinica tiene que existir tambien en el CRM (panel de plataforma),
 * o su subdominio no respondera. El DNS y el certificado ya cubren cualquier
 * subdominio (*.cliniventas.com, ver traefik/dynamic/active.yml).
 */

export type Inquilino = {
  nombre: string;
  /** Dominios de correo del equipo. Cualquiera de ellos vale para entrar. */
  dominios: string[];
  /** Correos sueltos que no usan un dominio propio (un Gmail, por ejemplo). */
  correos?: string[];
  url: string;
};

export const INQUILINOS: Inquilino[] = [
  {
    nombre: "DérmicaPro",
    dominios: ["dermicapro.com"],
    url: "https://dermicapro.cliniventas.com",
  },
];

/** Devuelve la clinica del correo, o null si no reconocemos el dominio. */
export function resolverInquilino(correo: string): Inquilino | null {
  const limpio = correo.trim().toLowerCase();
  const arroba = limpio.lastIndexOf("@");
  if (arroba < 1 || arroba === limpio.length - 1) return null;
  const dominio = limpio.slice(arroba + 1);

  return (
    INQUILINOS.find(
      (i) => i.correos?.includes(limpio) || i.dominios.includes(dominio),
    ) ?? null
  );
}
